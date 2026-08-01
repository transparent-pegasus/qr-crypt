// Key fingerprints.
// Internal identity is the complete sha256 hex; the abbreviated visual check
// users compare out of band is rendered by features/presentation.formatFingerprint.
import { exportAesKeyRaw } from "@/crypto/key-import-export"
import { toAppError } from "@/crypto/errors"
import { zeroize } from "@/crypto/pq/zeroize"
import { bytesToHex, sha256 } from "@/lib/bytes"

// AES: SHA-256 of the raw 32B key.
export async function fingerprintAesKey(key: CryptoKey): Promise<string> {
  let raw: Uint8Array | undefined
  try {
    raw = await exportAesKeyRaw(key)
    return bytesToHex(await sha256(raw))
  } catch (error) {
    throw toAppError(error, "KEY_TYPE_MISMATCH")
  } finally {
    zeroize(raw)
  }
}
