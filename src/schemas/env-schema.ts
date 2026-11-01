// Runtime validation for environment variables.
// Throw on invalid values at startup; never silently fall back to defaults.
import { z } from "zod"
import {
  FRAME_BYTES_MAX,
  isFrameBytes,
} from "@/lib/frame-bytes"
import { isFrameIntervalMs } from "@/lib/frame-interval"
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  type UiAlgorithm,
} from "@/schemas/domain"

export interface AppEnv {
  defaultAlgorithm: UiAlgorithm
  qrRenderSize: number
  // Post-quantum multipart plaintext ceiling.
  maxPlaintextBytes: number
  qrFrameBytes: number
  qrFrameIntervalMs: number
  qrMaxFrames: number
  autoClearSeconds: number
  autoClearFallbackSeconds: number
  buildSha: string
}

const intFromString = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value) => Number(value))
    .pipe(z.number().int().min(min).max(max))

const frameBytesFromString = z
  .string()
  .default(String(DEFAULT_GENERATED_DISPLAY_PAIR.frameBytes))
  .transform((value) => Number(value))
  .pipe(
    z.number().refine(isFrameBytes, {
      message: "must be a current frame-byte value",
    }),
  )

const frameIntervalMsFromString = z
  .string()
  .default(String(DEFAULT_GENERATED_DISPLAY_PAIR.frameIntervalMs))
  .transform((value) => Number(value))
  .pipe(
    z.number().refine(isFrameIntervalMs, {
      message: "must be a current frame-interval value",
    }),
  )

// Fixed portions obtained by decomposing the measured canonical-CBOR fixture for
// a maximum signed OCM2. Both the inner plaintext byte-string header and the
// outer ciphertext byte-string header vary with the plaintext length; at 120KB
// each uses a five-byte header. The ML-DSA-87 signature is fixed at 4,627B, the
// ML-KEM-1024 ciphertext at 1,568B, and the AES-GCM tag at 16B.
// tests/pq/maximum-artifact-size.golden.test.ts pins boundary equality with generated output.
const MAXIMUM_SIGNED_ARTIFACT_FIXED_BYTES = 6_566
const MAXIMUM_SIGNED_INNER_FIXED_BYTES = 4_822
// = AES_GCM_TAG_BYTES (lib/limits); kept local because limits imports this module.
const AES_GCM_TAG_BYTES = 16

function canonicalByteStringHeaderBytes(byteLength: number): number {
  if (byteLength <= 23) return 1
  if (byteLength <= 0xff) return 2
  if (byteLength <= 0xffff) return 3
  if (byteLength <= 0xffff_ffff) return 5
  return 9
}

function maximumSignedArtifactBytes(plaintextBytes: number): number {
  const plaintextHeaderBytes = canonicalByteStringHeaderBytes(plaintextBytes)
  const outerCiphertextBytes =
    MAXIMUM_SIGNED_INNER_FIXED_BYTES +
    plaintextHeaderBytes +
    plaintextBytes +
    AES_GCM_TAG_BYTES
  return (
    MAXIMUM_SIGNED_ARTIFACT_FIXED_BYTES +
    plaintextHeaderBytes +
    plaintextBytes +
    canonicalByteStringHeaderBytes(outerCiphertextBytes)
  )
}

const rawSchema = z.object({
  VITE_DEFAULT_ALGORITHM: z
    .enum(["A256GCM", "MLKEM1024_MLDSA87_A256GCM"])
    .default("A256GCM"),
  // 1024 keeps a version 40 symbol (177 modules plus an 8-module quiet zone) at about
  // 5.5 source pixels per module. At the former 512 the displayed raster, not the
  // camera, capped what a phone could resolve at the dense end of the density range.
  VITE_QR_RENDER_SIZE: intFromString(1024, 128, 1024),
  // Post-quantum multipart plaintext ceiling. Symmetric messages have a smaller,
  // fixed single-frame ceiling in lib/limits.
  VITE_MAX_PLAINTEXT_BYTES: intFromString(120_000, 1, 120_000),
  VITE_QR_FRAME_BYTES: frameBytesFromString,
  VITE_QR_FRAME_INTERVAL_MS: frameIntervalMsFromString,
  VITE_QR_MAX_FRAMES: intFromString(128, 1, 128),
  VITE_AUTO_CLEAR_SECONDS: intFromString(60, 0, 86_400),
  VITE_AUTO_CLEAR_FALLBACK_SECONDS: intFromString(300, 0, 86_400),
  VITE_BUILD_SHA: z.string().min(1).default("development"),
})

const APP_ENV_KEYS = new Set(Object.keys(rawSchema.shape))

export function parseAppEnv(raw: Record<string, unknown>): AppEnv {
  const unknownKeys = Object.keys(raw).filter(
    (key) => key.startsWith("VITE_") && !APP_ENV_KEYS.has(key),
  )
  if (unknownKeys.length > 0) {
    throw new Error(`Invalid environment variables: ${unknownKeys.join(", ")}`)
  }
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")
    throw new Error(`Invalid environment variables: ${paths}`)
  }
  const v = parsed.data
  if (
    ![DEFAULT_GENERATED_DISPLAY_PAIR, COMPATIBLE_GENERATED_DISPLAY_PAIR].some(
      (pair) =>
        pair.frameBytes === v.VITE_QR_FRAME_BYTES &&
        pair.frameIntervalMs === v.VITE_QR_FRAME_INTERVAL_MS,
    )
  ) {
    throw new Error(
      "Invalid environment variables: VITE_QR_FRAME_BYTES and VITE_QR_FRAME_INTERVAL_MS must form a supported display pair",
    )
  }
  // Reject configurations where a maximum signed artifact cannot fit at the
  // maximum internal density. Each artifact's renderer clamps independently;
  // the default display pair is not a boot-capacity constraint.
  const maximumSignedBytes = maximumSignedArtifactBytes(v.VITE_MAX_PLAINTEXT_BYTES)
  const configuredFrameCapacity = v.VITE_QR_MAX_FRAMES * FRAME_BYTES_MAX
  if (maximumSignedBytes > configuredFrameCapacity) {
    throw new Error(
      "Invalid environment variables: the maximum signed canonical CBOR for VITE_MAX_PLAINTEXT_BYTES does not fit within VITE_QR_MAX_FRAMES × the maximum selectable frame density",
    )
  }
  return {
    defaultAlgorithm: v.VITE_DEFAULT_ALGORITHM,
    qrRenderSize: v.VITE_QR_RENDER_SIZE,
    maxPlaintextBytes: v.VITE_MAX_PLAINTEXT_BYTES,
    qrFrameBytes: v.VITE_QR_FRAME_BYTES,
    qrFrameIntervalMs: v.VITE_QR_FRAME_INTERVAL_MS,
    qrMaxFrames: v.VITE_QR_MAX_FRAMES,
    autoClearSeconds: v.VITE_AUTO_CLEAR_SECONDS,
    autoClearFallbackSeconds: v.VITE_AUTO_CLEAR_FALLBACK_SECONDS,
    buildSha: v.VITE_BUILD_SHA,
  }
}

export const env: AppEnv = parseAppEnv(
  import.meta.env as unknown as Record<string, unknown>,
)
