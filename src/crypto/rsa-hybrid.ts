// RSA-OAEP-3072 + AES-256-GCM ハイブリッド(spec §9 / docs/qr-protocol.md §5)。
// RSA で本文を直接暗号化しない。秘密鍵は non-extractable。
import type { RsaHybridEnvelopeV1 } from "@/crypto/envelope"
import { buildAad } from "@/crypto/envelope"
import { AppError, toAppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { bytesEqual, toOwnedArrayBuffer } from "@/lib/bytes"
import {
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_CIPHERTEXT_BYTES,
  MAX_PLAINTEXT_BYTES,
  WRAPPED_KEY_BYTES,
} from "@/lib/limits"

// modulusLength 3072 / publicExponent 65537 / hash SHA-256
// publicKey: ["encrypt", "wrapKey"](extractable)
// privateKey: ["decrypt", "unwrapKey"](extractable: false)
export async function generateRsaKeyPair(): Promise<CryptoKeyPair> {
  try {
    return await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 3072,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      false,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    )
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export async function encryptRsaHybrid(args: {
  publicKey: CryptoKey
  recipientKeyId: string
  plaintext: Uint8Array
  now: number
}): Promise<RsaHybridEnvelopeV1> {
  try {
    if (
      args.plaintext.byteLength > MAX_PLAINTEXT_BYTES ||
      !KEY_ID_PATTERN.test(args.recipientKeyId) ||
      !Number.isSafeInteger(args.now) ||
      args.now <= 0
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
    const iv = randomBytes(IV_BYTES)
    const aad = buildAad({
      v: 1,
      type: "message",
      algorithm: "RSA-OAEP-3072+A256GCM",
      keyId: args.recipientKeyId,
      createdAt: args.now,
    })
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(iv),
          additionalData: toOwnedArrayBuffer(aad),
          tagLength: 128,
        },
        aesKey,
        toOwnedArrayBuffer(args.plaintext),
      ),
    )
    const wrappedKey = new Uint8Array(
      await crypto.subtle.wrapKey("raw", aesKey, args.publicKey, {
        name: "RSA-OAEP",
      }),
    )
    if (wrappedKey.byteLength !== WRAPPED_KEY_BYTES) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    return {
      v: 1,
      type: "message",
      algorithm: "RSA-OAEP-3072+A256GCM",
      recipientKeyId: args.recipientKeyId,
      createdAt: args.now,
      wrappedKey,
      iv,
      ciphertext,
      aad,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export async function decryptRsaHybrid(args: {
  privateKey: CryptoKey
  envelope: RsaHybridEnvelopeV1
}): Promise<Uint8Array> {
  try {
    const { envelope } = args
    if (
      envelope.wrappedKey.byteLength !== WRAPPED_KEY_BYTES ||
      envelope.iv.byteLength !== IV_BYTES ||
      envelope.ciphertext.byteLength < 16 ||
      envelope.ciphertext.byteLength > MAX_CIPHERTEXT_BYTES
    ) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const expectedAad = buildAad({
      v: envelope.v,
      type: envelope.type,
      algorithm: envelope.algorithm,
      keyId: envelope.recipientKeyId,
      createdAt: envelope.createdAt,
    })
    if (!bytesEqual(expectedAad, envelope.aad)) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const aesKey = await crypto.subtle.unwrapKey(
      "raw",
      toOwnedArrayBuffer(envelope.wrappedKey),
      args.privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    )
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(envelope.iv),
          additionalData: toOwnedArrayBuffer(expectedAad),
          tagLength: 128,
        },
        aesKey,
        toOwnedArrayBuffer(envelope.ciphertext),
      ),
    )
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new AppError("DECRYPTION_FAILED")
    }
    return plaintext
  } catch (error) {
    throw toAppError(error, "DECRYPTION_FAILED")
  }
}
