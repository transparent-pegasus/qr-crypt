// 鍵の import/export。import は必ず厳密検証を伴う。
import { AppError, toAppError } from "@/crypto/errors"
import { toOwnedArrayBuffer } from "@/lib/bytes"
import { AES_KEY_BYTES } from "@/lib/limits"

export async function exportAesKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  try {
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key))
    if (raw.byteLength !== AES_KEY_BYTES) {
      throw new AppError("KEY_TYPE_MISMATCH")
    }
    return raw
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}

// 32 バイト以外は AppError(INVALID_QR_PAYLOAD)。extractable: true で復元
export async function importAesKeyRaw(raw: Uint8Array): Promise<CryptoKey> {
  if (raw.byteLength !== AES_KEY_BYTES) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  try {
    return await crypto.subtle.importKey(
      "raw",
      toOwnedArrayBuffer(raw),
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
  } catch (error) {
    throw toAppError(error, "INVALID_QR_PAYLOAD")
  }
}

export async function exportPublicKeySpki(key: CryptoKey): Promise<Uint8Array> {
  try {
    if (key.type !== "public") throw new AppError("KEY_TYPE_MISMATCH")
    return new Uint8Array(await crypto.subtle.exportKey("spki", key))
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}

// importKey 成功後に type/algorithm.name/modulusLength===3072/
// publicExponent=[1,0,1]/hash===SHA-256 を検証(plan §13 C1)。
// パラメーター相違 → UNSUPPORTED_ALGORITHM / 破損 SPKI → INVALID_QR_PAYLOAD
export async function importPublicKeySpki(spki: Uint8Array): Promise<CryptoKey> {
  let key: CryptoKey
  try {
    key = await crypto.subtle.importKey(
      "spki",
      toOwnedArrayBuffer(spki),
      { name: "RSA-OAEP", hash: "SHA-256" },
      true,
      ["encrypt", "wrapKey"],
    )
  } catch {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  const algorithm = key.algorithm as RsaHashedKeyAlgorithm
  const exponent = algorithm.publicExponent
  if (
    key.type !== "public" ||
    algorithm.name !== "RSA-OAEP" ||
    algorithm.modulusLength !== 3072 ||
    !(exponent instanceof Uint8Array) ||
    exponent.byteLength !== 3 ||
    exponent[0] !== 1 ||
    exponent[1] !== 0 ||
    exponent[2] !== 1 ||
    algorithm.hash.name !== "SHA-256"
  ) {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  return key
}
