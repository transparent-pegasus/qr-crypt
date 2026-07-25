// OCF2 frame-density contract. env-schema.ts and limits.ts depend on each other,
// so this dependency-free module owns the contract and lets both reference it
// without creating a cycle.
export const FRAME_BYTES_VALUES = [100, 200] as const
export type FrameBytes = (typeof FRAME_BYTES_VALUES)[number]

export const FRAME_BYTES_MIN = FRAME_BYTES_VALUES[0]
export const FRAME_BYTES_MAX = FRAME_BYTES_VALUES[1]
export const FRAME_BYTES_STEP = 100

// Range that an older PWA may have stored. Keep boot-time reading append-only:
// narrowing it would make stored preferences unreadable and force wipeOnOnline true.
export const LEGACY_FRAME_BYTES_MIN = 100
export const LEGACY_FRAME_BYTES_MAX = 900

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
