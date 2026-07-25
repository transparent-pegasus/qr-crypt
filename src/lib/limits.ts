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

// Frame-setting range and fullscreen density grid from docs/qr-protocol-v2.md §6.
// Preferences/environment validation references this table. Stored off-grid integers
// remain readable; FRAME_BYTES_STEP applies only to the fullscreen range control.
export const FRAME_BYTES_MIN = 100
export const FRAME_BYTES_MAX = 900
export const FRAME_BYTES_STEP = 100

// Round the per-artifact floor onto the fullscreen density grid. The renderer clamps
// to this value before its first split, while leaving the stored preference unchanged.
export function minimumFrameBytesForArtifact(
  artifactByteLength: number,
  maximumFrames = env.qrMaxFrames,
): number {
  if (
    !Number.isSafeInteger(artifactByteLength) ||
    artifactByteLength < 1 ||
    !Number.isSafeInteger(maximumFrames) ||
    maximumFrames < 1 ||
    maximumFrames > PROTOCOL_MAX_FRAMES
  ) {
    throw new RangeError("artifact framing inputs out of range")
  }
  return (
    FRAME_BYTES_STEP *
    Math.ceil(Math.ceil(artifactByteLength / maximumFrames) / FRAME_BYTES_STEP)
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
// artifact                         bytes   OCF2 frames (100 / 200 / 900B)
// unsigned empty / max          1,887 / 5,986      19/10/3 / 60/30/7
// signed empty / max            6,613 / 10,711     >64/34/8 / >64/54/12
// OCI2 bundle                    4,402              45/23/5
// OCP2 KEM / OCS2 DSA           1,733 / 2,755      18/9/2 / 28/14/4
// OCB2 reserved sizing fixture   4,637              47/24/6
// All displayed OCF2 artifacts use the preference-controlled density. A signed-empty
// artifact is already 6,613B, so 100B cannot be the shipped default: 64×100=6,400B.
// The 200B default carries every measured artifact (64×200=12,800B) while retaining
// lower QR versions than the former 300B default for faster camera lock-on.
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
