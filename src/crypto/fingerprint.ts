// 鍵指紋(spec §11 / docs/qr-protocol.md §8)。
// 内部識別は sha256Hex 全体。display は簡易照合用の短縮表示。
import { exportAesKeyRaw, exportPublicKeySpki } from "@/crypto/key-import-export"
import { AppError, toAppError } from "@/crypto/errors"
import { bytesToHex, sha256 } from "@/lib/bytes"

export interface KeyFingerprint {
  sha256Hex: string
  display: string
}

// 先頭 8 バイトを 2 バイトずつ big-endian uint16 % 10000 → 4 桁ゼロ埋め × 4 グループ
export function formatFingerprintDisplay(hash: Uint8Array): string {
  if (hash.byteLength < 8) throw new AppError("INVALID_QR_PAYLOAD")
  const groups: string[] = []
  for (let offset = 0; offset < 8; offset += 2) {
    const value = ((hash[offset]! << 8) | hash[offset + 1]!) % 10_000
    groups.push(value.toString().padStart(4, "0"))
  }
  return groups.join(" ")
}

// AES: raw 32B を SHA-256
export async function fingerprintAesKey(key: CryptoKey): Promise<KeyFingerprint> {
  try {
    const hash = await sha256(await exportAesKeyRaw(key))
    return { sha256Hex: bytesToHex(hash), display: formatFingerprintDisplay(hash) }
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}

// 公開鍵: SPKI DER を SHA-256
export async function fingerprintPublicKey(key: CryptoKey): Promise<KeyFingerprint> {
  try {
    const hash = await sha256(await exportPublicKeySpki(key))
    return { sha256Hex: bytesToHex(hash), display: formatFingerprintDisplay(hash) }
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}
