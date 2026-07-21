// 環境変数の実行時検証(plan §13 C14)。
// boolean は "true"/"false" の列挙のみ受理し、z.coerce.boolean の罠を避ける。
// 不正値は起動時に throw する(黙って既定値へフォールバックしない)。
import { z } from "zod"
import type { QrEcLevel, UiAlgorithm } from "@/schemas/domain"

export interface AppEnv {
  appName: string
  appShortName: string
  defaultAlgorithm: UiAlgorithm
  qrErrorCorrection: QrEcLevel
  qrRenderSize: number
  maxPlaintextBytes: number
  enableRsa: boolean
  enableEcdh: boolean
  enablePrivateKeyExport: boolean
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
  VITE_DEFAULT_ALGORITHM: z.enum(["A256GCM", "RSA-HYBRID"]).default("A256GCM"),
  VITE_QR_ERROR_CORRECTION: z.enum(["L", "M", "Q", "H"]).default("Q"),
  VITE_QR_RENDER_SIZE: intFromString(512, 128, 1024),
  VITE_MAX_PLAINTEXT_BYTES: intFromString(4096, 1, 16384),
  VITE_ENABLE_RSA: boolFromString("true"),
  VITE_ENABLE_ECDH: boolFromString("false"),
  VITE_ENABLE_PRIVATE_KEY_EXPORT: boolFromString("false"),
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
  // 相関制約: RSA 無効時に既定方式が RSA を指していたら A256GCM へ正規化(C14)
  const defaultAlgorithm: UiAlgorithm =
    !v.VITE_ENABLE_RSA && v.VITE_DEFAULT_ALGORITHM === "RSA-HYBRID"
      ? "A256GCM"
      : v.VITE_DEFAULT_ALGORITHM
  return {
    appName: v.VITE_APP_NAME,
    appShortName: v.VITE_APP_SHORT_NAME,
    defaultAlgorithm,
    qrErrorCorrection: v.VITE_QR_ERROR_CORRECTION,
    qrRenderSize: v.VITE_QR_RENDER_SIZE,
    maxPlaintextBytes: v.VITE_MAX_PLAINTEXT_BYTES,
    enableRsa: v.VITE_ENABLE_RSA,
    enableEcdh: v.VITE_ENABLE_ECDH,
    enablePrivateKeyExport: v.VITE_ENABLE_PRIVATE_KEY_EXPORT,
    autoClearSeconds: v.VITE_AUTO_CLEAR_SECONDS,
    buildSha: v.VITE_BUILD_SHA,
  }
}

export const env: AppEnv = parseAppEnv(
  import.meta.env as unknown as Record<string, unknown>,
)
