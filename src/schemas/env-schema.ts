// 環境変数の実行時検証(plan §13 C14、v2: spec2 §15 / plan2.1 §I)。
// boolean は "true"/"false" の列挙のみ受理し、z.coerce.boolean の罠を避ける。
// 不正値は起動時に throw する(黙って既定値へフォールバックしない)。
import { z } from "zod"
import type { PqProfileId, QrEcLevel, UiAlgorithm } from "@/schemas/domain"

export interface AppEnv {
  appName: string
  appShortName: string
  defaultAlgorithm: UiAlgorithm
  defaultPqProfile: PqProfileId
  qrErrorCorrection: QrEcLevel
  qrRenderSize: number
  maxPlaintextBytes: number
  // RSA は廃止済み。互換的にプロパティを公開するが常に false。
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

// maximum 署名付き OCM2 の正準 CBOR 実測 fixture を式へ分解した固定部。
// SignedMessageBody の plaintext byte string だけが可変で、ML-DSA-87 署名は
// 4,627B、ML-KEM-1024 ciphertext は 1,568B、AES-GCM tag は 16B 固定。
// tests/pq/maximum-artifact-size.golden.test.ts が生成物との境界一致を固定する。
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
  VITE_APP_NAME: z.string().min(1).default("Qrypt"),
  VITE_APP_SHORT_NAME: z.string().min(1).default("Qrypt"),
  VITE_DEFAULT_ALGORITHM: z
    .enum(["A256GCM", "MLKEM1024_A256GCM", "MLKEM1024_MLDSA87_A256GCM"])
    .default("A256GCM"),
  VITE_DEFAULT_PQ_PROFILE: z.enum(["maximum"]).default("maximum"),
  VITE_QR_ERROR_CORRECTION: z.enum(["L", "M", "Q", "H"]).default("Q"),
  VITE_QR_RENDER_SIZE: intFromString(512, 128, 1024),
  VITE_MAX_PLAINTEXT_BYTES: intFromString(4096, 1, 16384),
  // 廃止済みの互換変数。true も受理するが parse 後は常に false。
  VITE_ENABLE_RSA: boolFromString("false"),
  VITE_ENABLE_ECDH: boolFromString("false"),
  VITE_ENABLE_ML_KEM: boolFromString("true"),
  VITE_ENABLE_ML_DSA: boolFromString("true"),
  VITE_REQUIRE_SIGNATURE: boolFromString("false"),
  VITE_ENABLE_PRIVATE_KEY_EXPORT: boolFromString("false"),
  VITE_ENABLE_ENCRYPTED_SEED_BACKUP: boolFromString("false"),
  VITE_QR_FRAME_BYTES: intFromString(600, 400, 900),
  VITE_QR_FRAME_INTERVAL_MS: intFromString(800, 150, 2000),
  VITE_QR_MAX_FRAMES: intFromString(64, 1, 64),
  // 未知のプロバイダー名は起動時エラー(plan2 §1-3)
  VITE_PQ_PROVIDER: z.enum(["noble"]).default("noble"),
  VITE_PQ_WORKER_ENABLED: boolFromString("true"),
  VITE_AUTO_CLEAR_SECONDS: intFromString(300, 0, 86_400),
  VITE_BUILD_SHA: z.string().min(1).default("development"),
})

export function parseAppEnv(raw: Record<string, unknown>): AppEnv {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) {
    const paths = parsed.error.issues.map((issue) => issue.path.join(".")).join(", ")
    throw new Error(`環境変数が不正です: ${paths}`)
  }
  const v = parsed.data
  // 相関制約(fail-closed。黙った縮退はここに列挙した正規化のみ):
  // 1) 署名必須なのに ML-DSA 無効は成立しない → 起動時エラー
  if (v.VITE_REQUIRE_SIGNATURE && !v.VITE_ENABLE_ML_DSA) {
    throw new Error(
      "環境変数が不正です: VITE_REQUIRE_SIGNATURE=true と VITE_ENABLE_ML_DSA=false は両立しません",
    )
  }
  // 2) maximum 署名付き最大平文の artifact 生バイトが、設定された OCF2
  //    chunk 総容量へ収まらない組合せは起動前に拒否する。
  const maximumSignedBytes = maximumSignedArtifactBytes(v.VITE_MAX_PLAINTEXT_BYTES)
  const configuredFrameCapacity = v.VITE_QR_MAX_FRAMES * v.VITE_QR_FRAME_BYTES
  if (maximumSignedBytes > configuredFrameCapacity) {
    throw new Error(
      "環境変数が不正です: VITE_MAX_PLAINTEXT_BYTES の maximum 署名付き正準 CBOR が VITE_QR_MAX_FRAMES × VITE_QR_FRAME_BYTES に収まりません",
    )
  }
  let defaultAlgorithm: UiAlgorithm = v.VITE_DEFAULT_ALGORITHM
  // 3) ML-KEM 無効時に既定方式が PQ を指していたら A256GCM へ正規化
  if (
    !v.VITE_ENABLE_ML_KEM &&
    (defaultAlgorithm === "MLKEM1024_A256GCM" ||
      defaultAlgorithm === "MLKEM1024_MLDSA87_A256GCM")
  ) {
    defaultAlgorithm = "A256GCM"
  }
  // 4) ML-DSA 無効時に既定方式が署名付き PQ なら非署名 PQ へ正規化
  if (!v.VITE_ENABLE_ML_DSA && defaultAlgorithm === "MLKEM1024_MLDSA87_A256GCM") {
    defaultAlgorithm = "MLKEM1024_A256GCM"
  }
  // 5) 署名必須なら既定 PQ 方式を署名付きへ正規化(plan2.1 §I。A256GCM は対象外)
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
    // VITE_ENABLE_RSA=true は廃止互換として無視する(plan2.1 §E4)。
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
