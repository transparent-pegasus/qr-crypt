// AES-256-GCM with one HKDF-derived key and random IV per symmetric message.
import { AppError, toAppError } from "@/crypto/errors"
import { exportAesKeyRaw } from "@/crypto/key-import-export"
import { encodeSymAadV2 } from "@/crypto/pq/canonical-cbor"
import { hkdfInfoSymV2 } from "@/crypto/pq/wire-bytes"
import { zeroize } from "@/crypto/pq/zeroize"
import { randomBytes } from "@/crypto/random"
import { toOwnedArrayBuffer } from "@/lib/bytes"
import {
  AES_GCM_TAG_BYTES,
  HKDF_SALT_BYTES,
  IV_BYTES,
  MAX_SYM_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { SYM_SUITE, type StoredKeyRecord, type SymMessageEnvelopeV2 } from "@/schemas/domain"

// extractable: true (required to generate a symmetric-key QR); usages: encrypt/decrypt.
export async function generateAesKey(): Promise<CryptoKey> {
  try {
    return await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ])
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

async function deriveSymMessageKey(
  sourceKey: CryptoKey,
  keyId: string,
  hkdfSalt: Uint8Array,
  usage: "encrypt" | "decrypt",
): Promise<CryptoKey> {
  let ikm: Uint8Array | undefined
  try {
    ikm = await exportAesKeyRaw(sourceKey)
    const hkdfKey = await crypto.subtle.importKey(
      "raw",
      toOwnedArrayBuffer(ikm),
      "HKDF",
      false,
      ["deriveKey"],
    )
    return await crypto.subtle.deriveKey(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt: toOwnedArrayBuffer(hkdfSalt),
        info: toOwnedArrayBuffer(hkdfInfoSymV2(keyId)),
      },
      hkdfKey,
      { name: "AES-GCM", length: 256 },
      false,
      [usage],
    )
  } finally {
    zeroize(ikm)
  }
}

export async function sealSymMessage(args: {
  record: StoredKeyRecord
  plaintext: Uint8Array
  now: number
}): Promise<SymMessageEnvelopeV2> {
  try {
    if (
      args.record.status !== "active" ||
      args.plaintext.byteLength > MAX_SYM_PLAINTEXT_BYTES ||
      !Number.isSafeInteger(args.now) ||
      args.now < 0
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }

    const hkdfSalt = randomBytes(HKDF_SALT_BYTES)
    const iv = randomBytes(IV_BYTES)
    const aad = encodeSymAadV2({
      version: 2,
      type: "sym-message",
      suite: SYM_SUITE,
      keyId: args.record.id,
      createdAt: args.now,
    })
    const messageKey = await deriveSymMessageKey(
      args.record.symmetricKey,
      args.record.id,
      hkdfSalt,
      "encrypt",
    )
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(iv),
          additionalData: toOwnedArrayBuffer(aad),
          tagLength: AES_GCM_TAG_BYTES * 8,
        },
        messageKey,
        toOwnedArrayBuffer(args.plaintext),
      ),
    )
    return {
      version: 2,
      type: "sym-message",
      suite: SYM_SUITE,
      keyId: args.record.id,
      createdAt: args.now,
      hkdfSalt,
      iv,
      ciphertext,
    }
  } catch {
    throw new AppError("ENCRYPTION_FAILED")
  }
}

export async function openSymMessage(args: {
  record: StoredKeyRecord
  envelope: SymMessageEnvelopeV2
}): Promise<Uint8Array> {
  try {
    const { envelope, record } = args
    if (
      envelope.keyId !== record.id ||
      envelope.hkdfSalt.byteLength !== HKDF_SALT_BYTES ||
      envelope.iv.byteLength !== IV_BYTES ||
      envelope.ciphertext.byteLength < AES_GCM_TAG_BYTES ||
      envelope.ciphertext.byteLength >
        MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }

    const aad = encodeSymAadV2({
      version: envelope.version,
      type: envelope.type,
      suite: envelope.suite,
      keyId: envelope.keyId,
      createdAt: envelope.createdAt,
    })
    const messageKey = await deriveSymMessageKey(
      record.symmetricKey,
      record.id,
      envelope.hkdfSalt,
      "decrypt",
    )
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(envelope.iv),
          additionalData: toOwnedArrayBuffer(aad),
          tagLength: AES_GCM_TAG_BYTES * 8,
        },
        messageKey,
        toOwnedArrayBuffer(envelope.ciphertext),
      ),
    )
    if (plaintext.byteLength > MAX_SYM_PLAINTEXT_BYTES) {
      zeroize(plaintext)
      throw new AppError("DECRYPTION_FAILED")
    }
    return plaintext
  } catch {
    throw new AppError("DECRYPTION_FAILED")
  }
}
