// Single derivation table for size constraints.
// Redefining these constraints in individual modules is prohibited.
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_STEP,
  FRAME_BYTES_VALUES,
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
  normalizeLegacyFrameBytes,
} from "@/lib/frame-bytes"
export {
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  FRAME_INTERVAL_MS_VALUES,
  isBootReadableFrameIntervalMs,
  isFrameIntervalMs,
  normalizeLegacyFrameIntervalMs,
  RELAY_PLAYBACK_FRAME_INTERVAL_MS,
} from "@/lib/frame-interval"

// One environment value serves two roles: MAX_PQ_PLAINTEXT_BYTES is the
// post-quantum multipart plaintext ceiling, and MAX_PLAINTEXT_BYTES is its
// shared allocation bound. Symmetric messages use the independent single-frame
// MAX_SYM_PLAINTEXT_BYTES ceiling below. The vault wraps fixed-length seeds.
export const MAX_PQ_PLAINTEXT_BYTES = env.maxPlaintextBytes
export const MAX_PLAINTEXT_BYTES = MAX_PQ_PLAINTEXT_BYTES

// AES-GCM IVs are fixed at 96 bits.
export const IV_BYTES = 12
export const AES_GCM_TAG_BYTES = 16

// Key IDs / artifact IDs: base64url of 16 random bytes (22 characters).
export const KEY_ID_PATTERN = /^[A-Za-z0-9_-]{22}$/
export const KEY_ID_RAW_BYTES = 16

// Raw AES-256 key length.
export const AES_KEY_BYTES = 32

// ---------------------------------------------------------------------------
// v2 wire limits; see docs/spec/qr-protocol-v2.md §3–§7.
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

// Select the least dense admitted frame that can carry the whole artifact.
export function singleFrameBytesFor(artifactByteLength: number): number {
  if (!Number.isSafeInteger(artifactByteLength) || artifactByteLength < 1) {
    throw new RangeError("artifact byte length is out of range")
  }
  const frameBytes = FRAME_BYTES_VALUES.find(
    (candidate) => candidate >= artifactByteLength,
  )
  if (frameBytes === undefined) {
    throw new RangeError("artifact exceeds the single-frame capacity")
  }
  return frameBytes
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

// At the maximum boundary: 1B map header + 159B fixed fields + 11B encoded
// ciphertext key + 3B byte-string header. Ciphertext bytes are excluded.
export const SYM_MESSAGE_OVERHEAD_BYTES = 174
export const MAX_SYM_PLAINTEXT_BYTES =
  FRAME_CHUNK_MAX_BYTES - SYM_MESSAGE_OVERHEAD_BYTES - AES_GCM_TAG_BYTES

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
