// OCF2 の表示間隔契約。env-schema.ts は limits.ts と相互依存するため、
// 循環を作らず両方から参照できる依存ゼロのモジュールで所有する。
export const FRAME_INTERVAL_MS_VALUES = [1_000, 1_500, 2_000, 2_500, 3_000] as const
export type FrameIntervalMs = (typeof FRAME_INTERVAL_MS_VALUES)[number]

export const FRAME_INTERVAL_MS_MIN = FRAME_INTERVAL_MS_VALUES[0]
export const FRAME_INTERVAL_MS_MAX = FRAME_INTERVAL_MS_VALUES[4]
export const FRAME_INTERVAL_MS_STEP = 500
export const FRAME_INTERVAL_MS_DEFAULT = 1_000

// 旧 PWA が保存し得た範囲。boot 読取では append-only とし、現行 grid とは分離する。
export const LEGACY_FRAME_INTERVAL_MS_MIN = 150
export const LEGACY_FRAME_INTERVAL_MS_MAX = 2_000

export function isFrameIntervalMs(value: unknown): value is FrameIntervalMs {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (FRAME_INTERVAL_MS_VALUES as readonly number[]).includes(value)
  )
}

export function isBootReadableFrameIntervalMs(value: unknown): value is number {
  return (
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= LEGACY_FRAME_INTERVAL_MS_MIN &&
      value <= LEGACY_FRAME_INTERVAL_MS_MAX) ||
    isFrameIntervalMs(value)
  )
}

export function normalizeLegacyFrameIntervalMs(value: number): FrameIntervalMs {
  if (!isBootReadableFrameIntervalMs(value)) {
    throw new RangeError("frameIntervalMs is not boot-readable")
  }
  const clamped = Math.min(FRAME_INTERVAL_MS_MAX, Math.max(FRAME_INTERVAL_MS_MIN, value))
  const rounded =
    FRAME_INTERVAL_MS_MIN +
    Math.floor(
      (clamped - FRAME_INTERVAL_MS_MIN + FRAME_INTERVAL_MS_STEP / 2) /
        FRAME_INTERVAL_MS_STEP,
    ) *
      FRAME_INTERVAL_MS_STEP
  if (!isFrameIntervalMs(rounded)) {
    throw new RangeError("normalized frameIntervalMs is off-grid")
  }
  return rounded
}
