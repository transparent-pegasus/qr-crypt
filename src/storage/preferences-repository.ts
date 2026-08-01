// Preferences persistence.
// The environment supplies defaults for defaultAlgorithm and qrErrorCorrection.
// Do not persist delays as preferences; use the
// WebAssembly-runtime-selected env.autoClearSeconds or
// env.autoClearFallbackSeconds value. As in v1, theme belongs to
// localStorage("oc-theme") and is outside this store.
import {
  COMPATIBLE_GENERATED_DISPLAY_PAIR,
  DEFAULT_GENERATED_DISPLAY_PAIR,
  PQ_PREFERENCE_DEFAULTS,
  type Preferences,
  type QrEcLevel,
  type UiAlgorithm,
} from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import {
  isBootReadableFrameBytes,
  isBootReadableFrameIntervalMs,
  isFrameBytes,
  isFrameIntervalMs,
  normalizeLegacyFrameBytes,
  normalizeLegacyFrameIntervalMs,
  RESET_CHURN_MB_MAX,
  RESET_CHURN_MB_MIN,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { env } from "@/schemas/env-schema"
import { getDb, STORE_PREFERENCES, type KeyValueRow } from "@/storage/database"

export const PREFERENCES_KEY = "preferences"

const UI_ALGORITHMS: readonly UiAlgorithm[] = [
  "A256GCM",
  "MLKEM1024_MLDSA87_A256GCM",
]

const PREFERENCE_KEYS = [
  "defaultAlgorithm",
  "qrErrorCorrection",
  "autoClearPlaintextAfterEncrypt",
  "backgroundClearEnabled",
  "frameBytes",
  "frameIntervalMs",
  "transferTimeoutMinutes",
  "wipeOnOnline",
  "resetChurnMb",
] as const satisfies readonly (keyof Preferences)[]

const EC_LEVELS: readonly QrEcLevel[] = ["L", "M", "Q", "H"]

export function defaultPreferences(): Preferences {
  return {
    ...PQ_PREFERENCE_DEFAULTS,
    defaultAlgorithm: env.defaultAlgorithm,
    qrErrorCorrection: env.qrErrorCorrection,
    autoClearPlaintextAfterEncrypt: true,
    backgroundClearEnabled: true,
    frameBytes: env.qrFrameBytes,
    frameIntervalMs: env.qrFrameIntervalMs,
  }
}

function isIntInRange(value: unknown, min: number, max: number): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= min &&
    value <= max
  )
}

function isGeneratedDisplayPreferencePair(
  frameBytes: unknown,
  frameIntervalMs: unknown,
): boolean {
  return (
    (frameBytes === DEFAULT_GENERATED_DISPLAY_PAIR.frameBytes &&
      frameIntervalMs === DEFAULT_GENERATED_DISPLAY_PAIR.frameIntervalMs) ||
    (frameBytes === COMPATIBLE_GENERATED_DISPLAY_PAIR.frameBytes &&
      frameIntervalMs === COMPATIBLE_GENERATED_DISPLAY_PAIR.frameIntervalMs)
  )
}

function normalizeLegacyStoredPreferences(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized: Record<string, unknown> = {}
  for (const key of PREFERENCE_KEYS) {
    if (Object.hasOwn(value, key)) normalized[key] = value[key]
  }
  switch (normalized.defaultAlgorithm) {
    case "RSA-HYBRID":
      normalized.defaultAlgorithm = "A256GCM"
      break
    default:
      if (
        normalized.defaultAlgorithm !== undefined &&
        !UI_ALGORITHMS.includes(normalized.defaultAlgorithm as UiAlgorithm)
      ) {
        delete normalized.defaultAlgorithm
      }
  }
  const frameBytesBootReadable = isBootReadableFrameBytes(normalized.frameBytes)
  const frameIntervalMsBootReadable = isBootReadableFrameIntervalMs(
    normalized.frameIntervalMs,
  )
  // Check the raw stored combination before per-field legacy normalization. A
  // historical/off-grid combination must not round into the compatible pair.
  if (
    frameBytesBootReadable &&
    frameIntervalMsBootReadable &&
    !isGeneratedDisplayPreferencePair(
      normalized.frameBytes,
      normalized.frameIntervalMs,
    )
  ) {
    normalized.frameBytes = DEFAULT_GENERATED_DISPLAY_PAIR.frameBytes
    normalized.frameIntervalMs =
      DEFAULT_GENERATED_DISPLAY_PAIR.frameIntervalMs
  }
  if (
    typeof normalized.frameBytes === "number" &&
    isBootReadableFrameBytes(normalized.frameBytes) &&
    !isFrameBytes(normalized.frameBytes)
  ) {
    normalized.frameBytes = normalizeLegacyFrameBytes(normalized.frameBytes)
  }
  if (
    typeof normalized.frameIntervalMs === "number" &&
    isBootReadableFrameIntervalMs(normalized.frameIntervalMs) &&
    !isFrameIntervalMs(normalized.frameIntervalMs)
  ) {
    normalized.frameIntervalMs = normalizeLegacyFrameIntervalMs(
      normalized.frameIntervalMs,
    )
  }
  return normalized
}

function validatePreferencesPatch(patch: unknown): asserts patch is Partial<Preferences> {
  if (typeof patch !== "object" || patch === null) {
    throw new AppError("STORAGE_FAILED")
  }
  const candidate = patch as Record<string, unknown>
  const hasFrameBytes = "frameBytes" in candidate
  const hasFrameIntervalMs = "frameIntervalMs" in candidate
  if (
    Object.keys(candidate).some(
      (key) => !(PREFERENCE_KEYS as readonly string[]).includes(key),
    ) ||
    ("defaultAlgorithm" in candidate &&
      !UI_ALGORITHMS.includes(candidate.defaultAlgorithm as UiAlgorithm)) ||
    hasFrameBytes !== hasFrameIntervalMs ||
    (hasFrameBytes &&
      (!isFrameBytes(candidate.frameBytes) ||
        !isFrameIntervalMs(candidate.frameIntervalMs) ||
        !isGeneratedDisplayPreferencePair(
          candidate.frameBytes,
          candidate.frameIntervalMs,
        )))
  ) {
    throw new AppError("STORAGE_FAILED")
  }
}

function validatePreferences(value: unknown): Preferences {
  if (typeof value !== "object" || value === null) {
    throw new AppError("STORAGE_FAILED")
  }
  const candidate = value as Partial<Preferences>
  if (
    !UI_ALGORITHMS.includes(candidate.defaultAlgorithm as UiAlgorithm) ||
    !EC_LEVELS.includes(candidate.qrErrorCorrection as QrEcLevel) ||
    typeof candidate.autoClearPlaintextAfterEncrypt !== "boolean" ||
    typeof candidate.backgroundClearEnabled !== "boolean" ||
    !isFrameBytes(candidate.frameBytes) ||
    !isFrameIntervalMs(candidate.frameIntervalMs) ||
    !isIntInRange(
      candidate.transferTimeoutMinutes,
      TRANSFER_TIMEOUT_MINUTES_MIN,
      TRANSFER_TIMEOUT_MINUTES_MAX,
    ) ||
    typeof candidate.wipeOnOnline !== "boolean" ||
    !isIntInRange(candidate.resetChurnMb, RESET_CHURN_MB_MIN, RESET_CHURN_MB_MAX)
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  return {
    defaultAlgorithm: candidate.defaultAlgorithm as UiAlgorithm,
    qrErrorCorrection: candidate.qrErrorCorrection as QrEcLevel,
    autoClearPlaintextAfterEncrypt: candidate.autoClearPlaintextAfterEncrypt,
    backgroundClearEnabled: candidate.backgroundClearEnabled,
    frameBytes: candidate.frameBytes,
    frameIntervalMs: candidate.frameIntervalMs,
    transferTimeoutMinutes: candidate.transferTimeoutMinutes,
    wipeOnOnline: candidate.wipeOnOnline,
    resetChurnMb: candidate.resetChurnMb,
  }
}

export async function getPreferences(): Promise<Preferences> {
  try {
    const row = await (await getDb()).get(STORE_PREFERENCES, PREFERENCES_KEY)
    if (row === undefined) return defaultPreferences()
    if (typeof row.value !== "object" || row.value === null) {
      throw new AppError("STORAGE_FAILED")
    }
    return validatePreferences({
      ...defaultPreferences(),
      ...normalizeLegacyStoredPreferences(row.value as Record<string, unknown>),
    })
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function updatePreferences(
  patch: Partial<Preferences>,
): Promise<Preferences> {
  try {
    validatePreferencesPatch(patch)
    const database = await getDb()
    const tx = database.transaction(STORE_PREFERENCES, "readwrite")
    const row = await tx.store.get(PREFERENCES_KEY)
    let current: Preferences
    if (row === undefined) current = defaultPreferences()
    else if (typeof row.value === "object" && row.value !== null) {
      current = validatePreferences({
        ...defaultPreferences(),
        ...normalizeLegacyStoredPreferences(row.value as Record<string, unknown>),
      })
    } else {
      throw new AppError("STORAGE_FAILED")
    }
    const updated = validatePreferences({ ...current, ...patch })
    const stored: KeyValueRow = { key: PREFERENCES_KEY, value: updated }
    await tx.store.put(stored)
    await tx.done
    return updated
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
