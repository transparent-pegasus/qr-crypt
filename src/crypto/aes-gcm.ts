// AES-256-GCM(spec §8 / docs/qr-protocol.md §5)。
// IV は暗号化ごとに randomBytes(12)。tagLength は 128 を明示。
import type { AesMessageEnvelopeV1 } from "@/crypto/envelope"
import { buildAad } from "@/crypto/envelope"
import { AppError, toAppError } from "@/crypto/errors"
import { randomBytes } from "@/crypto/random"
import { bytesEqual, toOwnedArrayBuffer } from "@/lib/bytes"
import {
  IV_BYTES,
  KEY_ID_PATTERN,
  MAX_CIPHERTEXT_BYTES,
  MAX_PLAINTEXT_BYTES,
} from "@/lib/limits"

// extractable: true(共通鍵 QR 生成のため)、usages: encrypt/decrypt
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

export async function encryptWithAesKey(args: {
  key: CryptoKey
  keyId: string
  plaintext: Uint8Array
  now: number
}): Promise<AesMessageEnvelopeV1> {
  try {
    if (
      args.plaintext.byteLength > MAX_PLAINTEXT_BYTES ||
      !KEY_ID_PATTERN.test(args.keyId) ||
      !Number.isSafeInteger(args.now) ||
      args.now <= 0
    ) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const iv = randomBytes(IV_BYTES)
    const aad = buildAad({
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: args.keyId,
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
        args.key,
        toOwnedArrayBuffer(args.plaintext),
      ),
    )
    return {
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: args.keyId,
      createdAt: args.now,
      iv,
      ciphertext,
      aad,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

// AAD はエンベロープから再計算し envelope.aad と一致検証してから復号。
// 復号結果が MAX_PLAINTEXT_BYTES 超なら DECRYPTION_FAILED(plan §13 C12)。
export async function decryptWithAesKey(args: {
  key: CryptoKey
  envelope: AesMessageEnvelopeV1
}): Promise<Uint8Array> {
  try {
    const { envelope } = args
    if (
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
      keyId: envelope.keyId,
      createdAt: envelope.createdAt,
    })
    if (!bytesEqual(expectedAad, envelope.aad)) {
      throw new AppError("DECRYPTION_FAILED")
    }
    const plaintext = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(envelope.iv),
          additionalData: toOwnedArrayBuffer(expectedAad),
          tagLength: 128,
        },
        args.key,
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
