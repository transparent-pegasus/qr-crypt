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
  enableRsa: boolean
  enableEcdh: boolean
  enableMlKem: boolean
  enableMlDsa: boolean
  // 初期リリースは false 固定(plan2.1 §A)。VITE_ENABLE_MAXIMUM_PQ の値は
  // 形式検証のみ行い、balanced 完了後の独立 WP まで無視する。
  enableMaximumPq: false
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

const rawSchema = z.object({
  VITE_APP_NAME: z.string().min(1).default("Qrypt"),
  VITE_APP_SHORT_NAME: z.string().min(1).default("Qrypt"),
  VITE_DEFAULT_ALGORITHM: z
    .enum(["A256GCM", "RSA-HYBRID", "MLKEM768_A256GCM", "MLKEM768_MLDSA65_A256GCM"])
    .default("A256GCM"),
  VITE_DEFAULT_PQ_PROFILE: z.enum(["balanced", "maximum"]).default("balanced"),
  VITE_QR_ERROR_CORRECTION: z.enum(["L", "M", "Q", "H"]).default("Q"),
  VITE_QR_RENDER_SIZE: intFromString(512, 128, 1024),
  VITE_MAX_PLAINTEXT_BYTES: intFromString(4096, 1, 16384),
  // 既定 true は WP-14(RSA 削除)で false へ反転する(plan2.1 §E4)
  VITE_ENABLE_RSA: boolFromString("true"),
  VITE_ENABLE_ECDH: boolFromString("false"),
  VITE_ENABLE_ML_KEM: boolFromString("true"),
  VITE_ENABLE_ML_DSA: boolFromString("true"),
  VITE_ENABLE_MAXIMUM_PQ: boolFromString("false"),
  VITE_REQUIRE_SIGNATURE: boolFromString("false"),
  VITE_ENABLE_PRIVATE_KEY_EXPORT: boolFromString("false"),
  VITE_ENABLE_ENCRYPTED_SEED_BACKUP: boolFromString("false"),
  VITE_QR_FRAME_BYTES: intFromString(600, 400, 900),
  VITE_QR_FRAME_INTERVAL_MS: intFromString(450, 150, 2000),
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
  let defaultAlgorithm: UiAlgorithm = v.VITE_DEFAULT_ALGORITHM
  // 2) RSA 無効時に既定方式が RSA を指していたら A256GCM へ正規化(C14)
  if (!v.VITE_ENABLE_RSA && defaultAlgorithm === "RSA-HYBRID") {
    defaultAlgorithm = "A256GCM"
  }
  // 3) ML-KEM 無効時に既定方式が PQ を指していたら A256GCM へ正規化
  if (
    !v.VITE_ENABLE_ML_KEM &&
    (defaultAlgorithm === "MLKEM768_A256GCM" ||
      defaultAlgorithm === "MLKEM768_MLDSA65_A256GCM")
  ) {
    defaultAlgorithm = "A256GCM"
  }
  // 4) ML-DSA 無効時に既定方式が署名付き PQ なら非署名 PQ へ正規化
  if (!v.VITE_ENABLE_ML_DSA && defaultAlgorithm === "MLKEM768_MLDSA65_A256GCM") {
    defaultAlgorithm = "MLKEM768_A256GCM"
  }
  // 5) 署名必須なら既定 PQ 方式を署名付きへ正規化(plan2.1 §I。A256GCM は対象外)
  if (v.VITE_REQUIRE_SIGNATURE && defaultAlgorithm === "MLKEM768_A256GCM") {
    defaultAlgorithm = "MLKEM768_MLDSA65_A256GCM"
  }
  return {
    appName: v.VITE_APP_NAME,
    appShortName: v.VITE_APP_SHORT_NAME,
    defaultAlgorithm,
    defaultPqProfile: v.VITE_DEFAULT_PQ_PROFILE,
    qrErrorCorrection: v.VITE_QR_ERROR_CORRECTION,
    qrRenderSize: v.VITE_QR_RENDER_SIZE,
    maxPlaintextBytes: v.VITE_MAX_PLAINTEXT_BYTES,
    enableRsa: v.VITE_ENABLE_RSA,
    enableEcdh: v.VITE_ENABLE_ECDH,
    enableMlKem: v.VITE_ENABLE_ML_KEM,
    enableMlDsa: v.VITE_ENABLE_ML_DSA,
    enableMaximumPq: false,
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
