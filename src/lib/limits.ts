// Single derivation table for size constraints.
// Redefining these constraints in individual modules is prohibited.
import { env } from "@/schemas/env-schema"
export {
  FRAME_INTERVAL_MS_DEFAULT,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  FRAME_INTERVAL_MS_STEP,
  FRAME_INTERVAL_MS_VALUES,
  isBootReadableFrameIntervalMs,
  isFrameIntervalMs,
  LEGACY_FRAME_INTERVAL_MS_MAX,
  LEGACY_FRAME_INTERVAL_MS_MIN,
  normalizeLegacyFrameIntervalMs,
  type FrameIntervalMs,
} from "@/lib/frame-interval"

// Maximum plaintext size in UTF-8 bytes, configurable via the environment.
export const MAX_PLAINTEXT_BYTES = env.maxPlaintextBytes

// AES-256-GCM size is plaintext length + a 16B authentication tag appended by WebCrypto.
export const MAX_CIPHERTEXT_BYTES = MAX_PLAINTEXT_BYTES + 16

// AAD ("OCAAD1|v|type|alg|keyId|createdAt") is about 60B in practice.
// This limit includes headroom.
export const MAX_AAD_BYTES = 128

// Payload-string limit exclusively for the v1 path; unused by v2.
// Maximum RSA hybrid envelope ≈ CBOR (9 fixed keys + ciphertext 4112B
// + wrappedKey 384B + iv 12B + aad ≤128B + string IDs) ≈ 4.7KB
// → base64url ≈ ceil(4700×4/3) ≈ 6267 + 5-character prefix ≈ 6.3K < 8192
// (including headroom).
export const MAX_PAYLOAD_CHARS = 8192

// Key IDs / artifact IDs: base64url of 16 random bytes (22 characters).
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
export const KEY_ID_RAW_BYTES = 16

// RSA-OAEP-3072 wrapping output is always the modulus length: 384B.
export const WRAPPED_KEY_BYTES = 384

// AES-GCM IVs are fixed at 96 bits.
export const IV_BYTES = 12

// Raw AES-256 key length.
export const AES_KEY_BYTES = 32

// ---------------------------------------------------------------------------
// v2 post-quantum limits; see docs/qr-protocol-v2.md §4–§6.
// ---------------------------------------------------------------------------

// HKDF-SHA-256 salt is 32B from the CSPRNG for each encryption.
export const HKDF_SALT_BYTES = 32

// messageId is a fixed 16B from the CSPRNG; it is not replay prevention.
export const MESSAGE_ID_BYTES = 16

// FIPS 203/204 KeyGen seed lengths.
export const KEM_SEED_BYTES = 64
export const DSA_SEED_BYTES = 32

// Frame-setting ranges and defaults from docs/qr-protocol-v2.md §6.
// Preferences/environment validation
// references this table. Do not lower FRAME_BYTES_MIN=400: if an older PWA bundle on
// the same origin shares IndexedDB and validates frameBytes < 400, it produces
// STORAGE_FAILED, which forces wipeOnOnline through boot's preferencesReadFailed path.
export const FRAME_BYTES_MIN = 400
export const FRAME_BYTES_MAX = 900
export const FRAME_BYTES_DEFAULT = 600
// Minimum chunk size used only by sender-side splitting. It is independent of the
// Preferences range to avoid the wipe hazard described above.
export const FRAME_CHUNK_MIN_BYTES = 200
// Fixed chunk size used only to display OCP2/OCS2 single-key QRs.
// It is not tied to settings/Preferences and is not persisted.
export const PQ_KEY_QR_FRAME_BYTES = 280
// For scanning stability, split OCI2 evenly into 20–25 frames targeting about 200B each.
export const PQ_IDENTITY_QR_TARGET_FRAME_BYTES = 200
export const PQ_IDENTITY_QR_FRAME_COUNT_MIN = 20
export const PQ_IDENTITY_QR_FRAME_COUNT_MAX = 25

export function pqIdentityQrFrameCount(artifactByteLength: number): number {
  if (!Number.isSafeInteger(artifactByteLength) || artifactByteLength < 1) {
    throw new RangeError("artifactByteLength out of range")
  }
  return Math.min(
    PQ_IDENTITY_QR_FRAME_COUNT_MAX,
    Math.max(
      PQ_IDENTITY_QR_FRAME_COUNT_MIN,
      Math.ceil(artifactByteLength / PQ_IDENTITY_QR_TARGET_FRAME_BYTES),
    ),
  )
}
export const TRANSFER_TIMEOUT_MINUTES_MIN = 1
export const TRANSFER_TIMEOUT_MINUTES_MAX = 120
export const TRANSFER_TIMEOUT_MINUTES_DEFAULT = 10
export const RESET_CHURN_MB_MIN = 0
export const RESET_CHURN_MB_MAX = 512

// Absolute protocol limit for receiver-side resource checks.
// The sender generation limit is separately constrained by env.qrMaxFrames (≤64).
// Measured maximum canonical CBOR on 2026-07-23 (maxPlaintext=4,096B,
// name=<three-character, 9-byte non-ASCII UTF-8 fixture>):
// artifact                         bytes   OCF2 frames (400 / 600 / 900B)
// unsigned empty / max          1,887 / 5,986       5/4/3 / 15/10/7
// signed empty / max            6,613 / 10,711     17/12/8 / 27/18/12
// OCI2 bundle                    4,402              12/8/5
// OCP2 KEM / OCS2 DSA           1,733 / 2,755       5/3/2 / 7/5/4
// OCB2 reserved sizing fixture   4,637              12/8/6
// OCI2 splits evenly by count: 4,402B → 23 frames (191/192B).
// Fixed 280B single-key chunks (PQ_KEY_QR_FRAME_BYTES): OCP2 1,733 → 7 / OCS2 2,755 → 10.
// maximum-artifact-size.golden.test.ts also pins actual EC-Q generation for every OCF2 string.
export const PROTOCOL_MAX_FRAMES = 64
export const FRAME_CHUNK_MAX_BYTES = FRAME_BYTES_MAX
export const MAX_ARTIFACT_BYTES_ABSOLUTE = PROTOCOL_MAX_FRAMES * FRAME_CHUNK_MAX_BYTES

// Sender: maximum raw artifact bytes generatable under the current frameBytes setting.
export function maxArtifactBytes(frameBytes: number): number {
  if (
    !Number.isSafeInteger(frameBytes) ||
    frameBytes < FRAME_BYTES_MIN ||
    frameBytes > FRAME_BYTES_MAX
  ) {
    throw new RangeError("frameBytes out of range")
  }
  return env.qrMaxFrames * frameBytes
}

// The OCF2 frame-string limit, including the prefix, equals QR v40 EC-Q byte capacity.
// Payloads are ASCII-only, so character count equals byte count; golden tests under
// tests/pq pin equality with the capacity table in qr/encode.ts.
export const MAX_FRAME_PAYLOAD_CHARS = 1663
