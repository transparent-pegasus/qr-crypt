// OCF2 frame-density contract. env-schema.ts and limits.ts depend on each other,
// so this dependency-free module owns the contract and lets both reference it
// without creating a cycle.
// 100 is the user-selected compatible density. Intermediate values remain admitted
// because an artifact can raise the effective density without changing the stored pair.
// splitIntoFrames validates against this complete generated-density set.
export const FRAME_BYTES_VALUES = [
  100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000,
] as const
export type FrameBytes = (typeof FRAME_BYTES_VALUES)[number]

export const FRAME_BYTES_MIN = FRAME_BYTES_VALUES[0]
export const FRAME_BYTES_MAX = FRAME_BYTES_VALUES[FRAME_BYTES_VALUES.length - 1]!
export const FRAME_BYTES_STEP = 100

// Range that an older PWA may have stored. Keep boot-time reading append-only:
// narrowing it would make stored preferences unreadable and force wipeOnOnline true.
export const LEGACY_FRAME_BYTES_MIN = 100
export const LEGACY_FRAME_BYTES_MAX = 1_000

export function isFrameBytes(value: unknown): value is FrameBytes {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    (FRAME_BYTES_VALUES as readonly number[]).includes(value)
  )
}

export function isBootReadableFrameBytes(
  value: unknown,
): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= LEGACY_FRAME_BYTES_MIN &&
      value <= LEGACY_FRAME_BYTES_MAX) ||
    isFrameBytes(value)
  )
}

export function normalizeLegacyFrameBytes(value: number): FrameBytes {
  if (!isBootReadableFrameBytes(value)) {
    throw new RangeError("frameBytes is not boot-readable")
  }
  const clamped = Math.min(FRAME_BYTES_MAX, Math.max(FRAME_BYTES_MIN, value))
  const rounded =
    FRAME_BYTES_MIN +
    Math.floor(
      (clamped - FRAME_BYTES_MIN + FRAME_BYTES_STEP / 2) / FRAME_BYTES_STEP,
    ) *
      FRAME_BYTES_STEP
  if (!isFrameBytes(rounded)) {
    throw new RangeError("normalized frameBytes is off-grid")
  }
  return rounded
}
