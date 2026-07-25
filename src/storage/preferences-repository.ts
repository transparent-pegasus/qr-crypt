// Preferences persistence.
// The environment supplies defaults for defaultAlgorithm, qrErrorCorrection,
// defaultPqProfile, and requireSignature. VITE_REQUIRE_SIGNATURE=true is a floor
// the user cannot lower. Do not persist delay as a preference; use the fixed
// env.autoClearSeconds value. As in v1, theme belongs to localStorage("oc-theme")
// and is outside this store.
import type { PqProfileId, Preferences, QrEcLevel, UiAlgorithm } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import {
  FRAME_BYTES_MAX,
  isBootReadableFrameBytes,
  isBootReadableFrameIntervalMs,
  isFrameBytes,
  isFrameIntervalMs,
  normalizeLegacyFrameIntervalMs,
  RESET_CHURN_MB_MAX,
  RESET_CHURN_MB_MIN,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { env } from "@/schemas/env-schema"
import { PQ_PREFERENCE_DEFAULTS } from "@/schemas/domain"
import { getDb, STORE_PREFERENCES, type KeyValueRow } from "@/storage/database"

const PREFERENCES_KEY = "preferences"

const UI_ALGORITHMS: readonly UiAlgorithm[] = [
  "A256GCM",
  "MLKEM1024_A256GCM",
  "MLKEM1024_MLDSA87_A256GCM",
]

const PQ_PROFILES_ALLOWED: readonly PqProfileId[] = ["maximum"]

const EC_LEVELS: readonly QrEcLevel[] = ["L", "M", "Q", "H"]

function defaults(): Preferences {
  return {
    ...PQ_PREFERENCE_DEFAULTS,
    defaultAlgorithm: env.defaultAlgorithm,
    defaultPqProfile: env.defaultPqProfile,
    requireSignature: env.requireSignature,
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

function normalizeLegacyStoredPreferences(
  value: Record<string, unknown>,
): Record<string, unknown> {
  const normalized = { ...value }
  switch (normalized.defaultAlgorithm) {
    case "RSA-HYBRID":
      normalized.defaultAlgorithm = "A256GCM"
      break
    case "MLKEM768_A256GCM":
      normalized.defaultAlgorithm = "MLKEM1024_A256GCM"
      break
    case "MLKEM768_MLDSA65_A256GCM":
      normalized.defaultAlgorithm = "MLKEM1024_MLDSA87_A256GCM"
      break
  }
  if (normalized.defaultPqProfile === "balanced") {
    normalized.defaultPqProfile = "maximum"
  }
  if (
    isBootReadableFrameIntervalMs(normalized.frameIntervalMs) &&
    !isFrameIntervalMs(normalized.frameIntervalMs)
  ) {
    normalized.frameIntervalMs = normalizeLegacyFrameIntervalMs(
      normalized.frameIntervalMs,
    )
  }
  if (
    (normalized.requireSignature === true || env.requireSignature) &&
    normalized.defaultAlgorithm === "MLKEM1024_A256GCM"
  ) {
    normalized.defaultAlgorithm = env.enableMlDsa
      ? "MLKEM1024_MLDSA87_A256GCM"
      : "A256GCM"
  }
  return normalized
}

function validatePreferencesPatch(patch: unknown): asserts patch is Partial<Preferences> {
  if (typeof patch !== "object" || patch === null) {
    throw new AppError("STORAGE_FAILED")
  }
  const candidate = patch as Record<string, unknown>
  if (
    ("defaultAlgorithm" in candidate &&
      !UI_ALGORITHMS.includes(candidate.defaultAlgorithm as UiAlgorithm)) ||
    ("defaultPqProfile" in candidate &&
      !PQ_PROFILES_ALLOWED.includes(candidate.defaultPqProfile as PqProfileId)) ||
    ("frameBytes" in candidate && !isFrameBytes(candidate.frameBytes)) ||
    ("frameIntervalMs" in candidate && !isFrameIntervalMs(candidate.frameIntervalMs))
  ) {
    throw new AppError("STORAGE_FAILED")
  }
}

function validatePreferences(value: unknown): Preferences {
  if (typeof value !== "object" || value === null) {
    throw new AppError("STORAGE_FAILED")
  }
  const candidate = value as Partial<Preferences>
  const frameBytes =
    typeof candidate.frameBytes === "number" &&
    candidate.frameBytes > FRAME_BYTES_MAX &&
    isBootReadableFrameBytes(candidate.frameBytes)
      ? FRAME_BYTES_MAX
      : candidate.frameBytes
  const signatureRequired = candidate.requireSignature === true || env.requireSignature
  const defaultAlgorithm =
    signatureRequired && candidate.defaultAlgorithm === "MLKEM1024_A256GCM"
      ? env.enableMlDsa
        ? "MLKEM1024_MLDSA87_A256GCM"
        : "A256GCM"
      : candidate.defaultAlgorithm
  if (
    !UI_ALGORITHMS.includes(defaultAlgorithm as UiAlgorithm) ||
    !PQ_PROFILES_ALLOWED.includes(candidate.defaultPqProfile as PqProfileId) ||
    typeof candidate.requireSignature !== "boolean" ||
    !EC_LEVELS.includes(candidate.qrErrorCorrection as QrEcLevel) ||
    typeof candidate.autoClearPlaintextAfterEncrypt !== "boolean" ||
    typeof candidate.backgroundClearEnabled !== "boolean" ||
    !isFrameBytes(frameBytes) ||
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
    defaultAlgorithm: defaultAlgorithm as UiAlgorithm,
    defaultPqProfile: candidate.defaultPqProfile as PqProfileId,
    // The environment's signature requirement is a floor.
    requireSignature: signatureRequired,
    qrErrorCorrection: candidate.qrErrorCorrection as QrEcLevel,
    autoClearPlaintextAfterEncrypt: candidate.autoClearPlaintextAfterEncrypt,
    backgroundClearEnabled: candidate.backgroundClearEnabled,
    frameBytes,
    frameIntervalMs: candidate.frameIntervalMs,
    transferTimeoutMinutes: candidate.transferTimeoutMinutes,
    wipeOnOnline: candidate.wipeOnOnline,
    resetChurnMb: candidate.resetChurnMb,
  }
}

export async function getPreferences(): Promise<Preferences> {
  try {
    const row = await (await getDb()).get(STORE_PREFERENCES, PREFERENCES_KEY)
    if (row === undefined) return defaults()
    if (typeof row.value !== "object" || row.value === null) {
      throw new AppError("STORAGE_FAILED")
    }
    return validatePreferences({
      ...defaults(),
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
    if (row === undefined) current = defaults()
    else if (typeof row.value === "object" && row.value !== null) {
      current = validatePreferences({
        ...defaults(),
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
