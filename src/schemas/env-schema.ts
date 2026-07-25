// Runtime validation for environment variables.
// Accept only the explicit "true"/"false" enumeration for booleans to avoid the
// z.coerce.boolean trap. Throw on invalid values at startup; never silently fall
// back to defaults.
import { z } from "zod"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  isFrameBytes,
} from "@/lib/frame-bytes"
import {
  FRAME_INTERVAL_MS_DEFAULT,
  isFrameIntervalMs,
} from "@/lib/frame-interval"
import type { PqProfileId, QrEcLevel, UiAlgorithm } from "@/schemas/domain"

export interface AppEnv {
  appName: string
  appShortName: string
  defaultAlgorithm: UiAlgorithm
  defaultPqProfile: PqProfileId
  qrErrorCorrection: QrEcLevel
  qrRenderSize: number
  maxPlaintextBytes: number
  // RSA has been retired. Expose the property for compatibility, but it is always false.
  enableRsa: false
  enableEcdh: boolean
  enableMlKem: boolean
  enableMlDsa: boolean
  requireSignature: boolean
  enablePrivateKeyExport: boolean
  enableEncryptedSeedBackup: boolean
  qrFrameBytes: number
  qrFrameIntervalMs: number
  qrMaxFrames: number
  pqProvider: "noble"
  pqWorkerEnabled: boolean
  autoClearSeconds: number
  buildSha: string
}

const boolFromString = (defaultValue: "true" | "false") =>
  z
    .enum(["true", "false"])
    .default(defaultValue)
    .transform((value) => value === "true")

const intFromString = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .default(String(defaultValue))
    .transform((value) => Number(value))
    .pipe(z.number().int().min(min).max(max))

const frameBytesFromString = z
  .string()
  .default(String(FRAME_BYTES_MIN))
  .transform((value) => Number(value))
  .pipe(
    z.number().refine(isFrameBytes, {
      message: "must be a current frame-byte value",
    }),
  )

const frameIntervalMsFromString = z
  .string()
  .default(String(FRAME_INTERVAL_MS_DEFAULT))
  .transform((value) => Number(value))
  .pipe(
    z.number().refine(isFrameIntervalMs, {
      message: "must be a current frame-interval value",
    }),
  )

// Fixed portion obtained by decomposing the measured canonical-CBOR fixture for a
// maximum signed OCM2 into an expression. Only the plaintext byte string in
// SignedMessageBody varies; the ML-DSA-87 signature is fixed at 4,627B, the
// ML-KEM-1024 ciphertext at 1,568B, and the AES-GCM tag at 16B.
// tests/pq/maximum-artifact-size.golden.test.ts pins boundary equality with generated output.
const MAXIMUM_SIGNED_ARTIFACT_FIXED_BYTES = 6_612

function canonicalByteStringHeaderBytes(byteLength: number): number {
  if (byteLength <= 23) return 1
  if (byteLength <= 0xff) return 2
  if (byteLength <= 0xffff) return 3
  if (byteLength <= 0xffff_ffff) return 5
  return 9
}

function maximumSignedArtifactBytes(plaintextBytes: number): number {
  return (
    MAXIMUM_SIGNED_ARTIFACT_FIXED_BYTES +
    canonicalByteStringHeaderBytes(plaintextBytes) +
    plaintextBytes
  )
}

const rawSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default("QR Crypt"),
  VITE_APP_SHORT_NAME: z.string().min(1).default("QR Crypt"),
  VITE_DEFAULT_ALGORITHM: z
    .enum(["A256GCM", "MLKEM1024_A256GCM", "MLKEM1024_MLDSA87_A256GCM"])
    .default("A256GCM"),
  VITE_DEFAULT_PQ_PROFILE: z.enum(["maximum"]).default("maximum"),
  VITE_QR_ERROR_CORRECTION: z.enum(["L", "M", "Q", "H"]).default("Q"),
  VITE_QR_RENDER_SIZE: intFromString(512, 128, 1024),
  VITE_MAX_PLAINTEXT_BYTES: intFromString(4096, 1, 16384),
  // Retired compatibility variable. Accept true, but always produce false after parsing.
  VITE_ENABLE_RSA: boolFromString("false"),
  VITE_ENABLE_ECDH: boolFromString("false"),
  VITE_ENABLE_ML_KEM: boolFromString("true"),
  VITE_ENABLE_ML_DSA: boolFromString("true"),
  VITE_REQUIRE_SIGNATURE: boolFromString("false"),
  VITE_ENABLE_PRIVATE_KEY_EXPORT: boolFromString("false"),
  VITE_ENABLE_ENCRYPTED_SEED_BACKUP: boolFromString("false"),
  VITE_QR_FRAME_BYTES: frameBytesFromString,
  VITE_QR_FRAME_INTERVAL_MS: frameIntervalMsFromString,
  VITE_QR_MAX_FRAMES: intFromString(128, 1, 128),
  // Unknown provider names are startup errors.
  VITE_PQ_PROVIDER: z.enum(["noble"]).default("noble"),
  VITE_PQ_WORKER_ENABLED: boolFromString("true"),
  VITE_AUTO_CLEAR_SECONDS: intFromString(300, 0, 86_400),
  VITE_BUILD_SHA: z.string().min(1).default("development"),
})

export function parseAppEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")
    throw new Error(`Invalid environment variables: ${paths}`)
  }
  const v = parsed.data
  // Cross-field constraints (fail closed; the only silent degradations are the
  // normalizations listed here):
  // 1) Requiring signatures while ML-DSA is disabled is invalid → startup error.
  if (v.VITE_REQUIRE_SIGNATURE && !v.VITE_ENABLE_ML_DSA) {
    throw new Error(
      "Invalid environment variables: VITE_REQUIRE_SIGNATURE=true and VITE_ENABLE_ML_DSA=false cannot be used together",
    )
  }
  // 2) Reject before startup any configuration where the raw artifact bytes for a
  //    maximum signed message with maximum plaintext do not fit at the maximum
  //    selectable density. The renderer clamps each artifact independently, so the
  //    stored/default density is not a boot-capacity constraint.
  const maximumSignedBytes = maximumSignedArtifactBytes(v.VITE_MAX_PLAINTEXT_BYTES)
  const configuredFrameCapacity = v.VITE_QR_MAX_FRAMES * FRAME_BYTES_MAX
  if (maximumSignedBytes > configuredFrameCapacity) {
    throw new Error(
      "Invalid environment variables: the maximum signed canonical CBOR for VITE_MAX_PLAINTEXT_BYTES does not fit within VITE_QR_MAX_FRAMES × the maximum selectable frame density",
    )
  }
  let defaultAlgorithm: UiAlgorithm = v.VITE_DEFAULT_ALGORITHM
  // 3) If ML-KEM is disabled and the default algorithm points to PQ, normalize to A256GCM.
  if (
    !v.VITE_ENABLE_ML_KEM &&
    (defaultAlgorithm === "MLKEM1024_A256GCM" ||
      defaultAlgorithm === "MLKEM1024_MLDSA87_A256GCM")
  ) {
    defaultAlgorithm = "A256GCM"
  }
  // 4) If ML-DSA is disabled and the default is signed PQ, normalize to unsigned PQ.
  if (!v.VITE_ENABLE_ML_DSA && defaultAlgorithm === "MLKEM1024_MLDSA87_A256GCM") {
    defaultAlgorithm = "MLKEM1024_A256GCM"
  }
  // 5) If signatures are required, normalize the default PQ algorithm to signed PQ.
  //    A256GCM is excluded.
  if (v.VITE_REQUIRE_SIGNATURE && defaultAlgorithm === "MLKEM1024_A256GCM") {
    defaultAlgorithm = "MLKEM1024_MLDSA87_A256GCM"
  }
  return {
    appName: v.VITE_APP_NAME,
    appShortName: v.VITE_APP_SHORT_NAME,
    defaultAlgorithm,
    defaultPqProfile: v.VITE_DEFAULT_PQ_PROFILE,
    qrErrorCorrection: v.VITE_QR_ERROR_CORRECTION,
    qrRenderSize: v.VITE_QR_RENDER_SIZE,
    maxPlaintextBytes: v.VITE_MAX_PLAINTEXT_BYTES,
    // Ignore VITE_ENABLE_RSA=true as retired compatibility behavior.
    enableRsa: false,
    enableEcdh: v.VITE_ENABLE_ECDH,
    enableMlKem: v.VITE_ENABLE_ML_KEM,
    enableMlDsa: v.VITE_ENABLE_ML_DSA,
    requireSignature: v.VITE_REQUIRE_SIGNATURE,
    enablePrivateKeyExport: v.VITE_ENABLE_PRIVATE_KEY_EXPORT,
    enableEncryptedSeedBackup: v.VITE_ENABLE_ENCRYPTED_SEED_BACKUP,
    qrFrameBytes: v.VITE_QR_FRAME_BYTES,
    qrFrameIntervalMs: v.VITE_QR_FRAME_INTERVAL_MS,
    qrMaxFrames: v.VITE_QR_MAX_FRAMES,
    pqProvider: v.VITE_PQ_PROVIDER,
    pqWorkerEnabled: v.VITE_PQ_WORKER_ENABLED,
    autoClearSeconds: v.VITE_AUTO_CLEAR_SECONDS,
    buildSha: v.VITE_BUILD_SHA,
  }
}

export const env: AppEnv = parseAppEnv(
  import.meta.env as unknown as Record<string, unknown>,
)
