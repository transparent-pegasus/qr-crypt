// Key fingerprints; see docs/qr-protocol.md §8.
// Internal identity uses the complete sha256Hex; display is an abbreviated visual check.
import { exportAesKeyRaw } from "@/crypto/key-import-export"
import { AppError, toAppError } from "@/crypto/errors"
import { bytesToHex, sha256 } from "@/lib/bytes"

export interface KeyFingerprint {
  sha256Hex: string
  display: string
}

// Split the first 8 bytes into big-endian uint16 pairs, take each modulo 10000,
// and format four zero-padded 4-digit groups.
export function formatFingerprintDisplay(hash: Uint8Array): string {
  if (hash.byteLength < 8) throw new AppError("INVALID_QR_PAYLOAD")
  const groups: string[] = []
  for (let offset = 0; offset < 8; offset += 2) {
    const value = ((hash[offset]! << 8) | hash[offset + 1]!) % 10_000
    groups.push(value.toString().padStart(4, "0"))
  }
  return groups.join(" ")
}

// AES: SHA-256 of the raw 32B key.
export async function fingerprintAesKey(key: CryptoKey): Promise<KeyFingerprint> {
  try {
    const hash = await sha256(await exportAesKeyRaw(key))
    return { sha256Hex: bytesToHex(hash), display: formatFingerprintDisplay(hash) }
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  }
}
