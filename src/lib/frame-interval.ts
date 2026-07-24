// OCF2 display-interval contract. env-schema.ts and limits.ts depend on each other,
// so this dependency-free module owns the contract and lets both reference it
// without creating a cycle.
export const FRAME_INTERVAL_MS_VALUES = [1_000, 1_500, 2_000, 2_500, 3_000] as const
export type FrameIntervalMs = (typeof FRAME_INTERVAL_MS_VALUES)[number]

export const FRAME_INTERVAL_MS_MIN = FRAME_INTERVAL_MS_VALUES[0]
export const FRAME_INTERVAL_MS_MAX = FRAME_INTERVAL_MS_VALUES[4]
export const FRAME_INTERVAL_MS_STEP = 500
export const FRAME_INTERVAL_MS_DEFAULT = 1_000

// Range that an older PWA may have stored. Keep boot-time reading append-only
// and separate it from the current grid.
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
