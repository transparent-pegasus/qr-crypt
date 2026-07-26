// Single derivation table for size constraints.
// Redefining these constraints in individual modules is prohibited.
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_STEP,
} from "@/lib/frame-bytes"
import { FRAME_INTERVAL_MS_MAX } from "@/lib/frame-interval"
import { env } from "@/schemas/env-schema"
export {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_BYTES_STEP,
  FRAME_BYTES_VALUES,
  isBootReadableFrameBytes,
  isFrameBytes,
  LEGACY_FRAME_BYTES_MAX,
  LEGACY_FRAME_BYTES_MIN,
  normalizeLegacyFrameBytes,
  type FrameBytes,
} from "@/lib/frame-bytes"
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

// The environment-configured plaintext ceiling belongs to the post-quantum
// multipart path. MAX_PLAINTEXT_BYTES remains the shared crypto allocation
// ceiling; the A256GCM UI must additionally apply the v1 single-QR bound below.
export const MAX_PQ_PLAINTEXT_BYTES = env.maxPlaintextBytes
export const MAX_PLAINTEXT_BYTES = MAX_PQ_PLAINTEXT_BYTES


// AAD ("OCAAD1|v|type|alg|keyId|createdAt") is about 60B in practice.
// This limit includes headroom.
export const MAX_AAD_BYTES = 128

// Payload-string limit exclusively for the v1 path; unused by v2.
// Maximum RSA hybrid envelope ≈ CBOR (9 fixed keys + ciphertext 4112B
// + wrappedKey 384B + iv 12B + aad ≤128B + string IDs) ≈ 4.7KB
// → base64url ≈ ceil(4700×4/3) ≈ 6267 + 5-character prefix ≈ 6.3K < 8192
// (including headroom).
export const MAX_PAYLOAD_CHARS = 8192

// A v1 A256GCM message has a five-character OCM1 prefix and at most 201
// non-plaintext CBOR bytes: the fixed eight-entry map, fixed fields, a
// 16-byte GCM tag, and the longest valid decimal createdAt in both the map
// and AAD. cbor-x uses a three-byte map header in this profile.
const V1_MESSAGE_PREFIX_CHARS = 5
const V1_MESSAGE_MAX_FIXED_CBOR_BYTES = 201

// Derive the pre-encryption A256GCM limit from both independent encoded-text
// ceilings. The caller supplies qrByteCapacity(selectedEcLevel), keeping the
// QR capacity table owned by qr/encode.ts and making preference changes explicit.
export function maximumSymmetricPlaintextBytesForPayloadCapacity(
  qrPayloadCapacityChars: number,
): number {
  if (
    !Number.isSafeInteger(qrPayloadCapacityChars) ||
    qrPayloadCapacityChars <= V1_MESSAGE_PREFIX_CHARS
  ) {
    throw new RangeError("v1 QR payload capacity is out of range")
  }
  const payloadChars = Math.min(MAX_PAYLOAD_CHARS, qrPayloadCapacityChars)
  const base64UrlChars = payloadChars - V1_MESSAGE_PREFIX_CHARS
  const maximumCborBytes = Math.floor((base64UrlChars * 3) / 4)
  return Math.max(0, maximumCborBytes - V1_MESSAGE_MAX_FIXED_CBOR_BYTES)
}

// Structural v1 ceiling: the most a single OCM1 payload can carry at any EC level.
// The UI narrows this further with the selected level's QR capacity.
export const MAX_SYMMETRIC_PLAINTEXT_BYTES =
  maximumSymmetricPlaintextBytesForPayloadCapacity(MAX_PAYLOAD_CHARS)

// AES-256-GCM size is plaintext length + a 16B authentication tag appended by WebCrypto.
// The v1 envelope is bounded by what a single OCM1 payload can carry, NOT by the
// post-quantum multipart ceiling: tying it to MAX_PLAINTEXT_BYTES would let the v1
// decoder accept envelopes no legitimate v1 QR could ever contain.
export const MAX_CIPHERTEXT_BYTES = MAX_SYMMETRIC_PLAINTEXT_BYTES + 16


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

// Round the per-artifact floor onto the density grid. The renderer clamps
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
// The active internal density reaches the 1,000-byte chunk ceiling, so the
// density-derived artifact capacity and the algebraic wire budget now coincide.
// This intentionally permits at most 128,000 bytes of attacker-controlled
// artifact input across 128 frames; CBOR applies separate structural limits.
// A maximum 120,000-byte signed message is 126,619 bytes and uses 127 frames.
export const PROTOCOL_MAX_FRAMES = 128
export const FRAME_CHUNK_MAX_BYTES = FRAME_BYTES_MAX
export const MAX_ARTIFACT_BYTES_ABSOLUTE =
  PROTOCOL_MAX_FRAMES * FRAME_CHUNK_MAX_BYTES

// Cover a complete cycle at the slowest admitted display interval. The maximum
// signed message takes 127 × 2,000ms = 254s; deriving from the full 128-frame
// protocol budget is conservative (256s) and rounds up to a five-minute floor.
const MILLISECONDS_PER_MINUTE = 60_000
export const TRANSFER_TIMEOUT_MINUTES_MIN = Math.ceil(
  (PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MAX) / MILLISECONDS_PER_MINUTE,
)
export const TRANSFER_TIMEOUT_MINUTES_MAX = 120
export const TRANSFER_TIMEOUT_MINUTES_DEFAULT = 10
export const RESET_CHURN_MB_MIN = 0
export const RESET_CHURN_MB_MAX = 512

// The OCF2 frame-string limit, including the prefix, equals QR v40 EC-Q byte capacity.
// Payloads are ASCII-only, so character count equals byte count; golden tests under
// tests/pq pin equality with the capacity table in qr/encode.ts.
export const MAX_FRAME_PAYLOAD_CHARS = 1663
