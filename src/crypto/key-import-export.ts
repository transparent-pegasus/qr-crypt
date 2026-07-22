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
