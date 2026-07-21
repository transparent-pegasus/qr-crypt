// 設定の永続化(spec §28)。既定値は env 由来(plan §12-6):
// defaultAlgorithm/qrErrorCorrection = env、
// autoClearPlaintextAfterEncrypt = false(spec §7.2)、
// backgroundClearSeconds = env.autoClearSeconds。
import type { Preferences } from "@/schemas/domain"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function getPreferences(): Promise<Preferences> {
  return notImplemented()
}

export function updatePreferences(
  patch: Partial<Preferences>,
): Promise<Preferences> {
  return notImplemented(patch)
}
