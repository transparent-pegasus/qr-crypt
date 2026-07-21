// 設定の永続化(spec §28)。既定値は env 由来(plan §12-6):
// defaultAlgorithm/qrErrorCorrection = env、
// autoClearPlaintextAfterEncrypt = false(spec §7.2)、
// backgroundClearSeconds = env.autoClearSeconds。
import type { Preferences } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { env } from "@/schemas/env-schema"
import { getDb, STORE_PREFERENCES, type KeyValueRow } from "@/storage/database"

const PREFERENCES_KEY = "preferences"

function defaults(): Preferences {
  return {
    defaultAlgorithm: env.defaultAlgorithm,
    qrErrorCorrection: env.qrErrorCorrection,
    autoClearPlaintextAfterEncrypt: false,
    backgroundClearSeconds: env.autoClearSeconds,
  }
}

function validatePreferences(value: unknown): Preferences {
  if (typeof value !== "object" || value === null) {
    throw new AppError("STORAGE_FAILED")
  }
  const candidate = value as Partial<Preferences>
  if (
    (candidate.defaultAlgorithm !== "A256GCM" &&
      candidate.defaultAlgorithm !== "RSA-HYBRID") ||
    (candidate.qrErrorCorrection !== "L" &&
      candidate.qrErrorCorrection !== "M" &&
      candidate.qrErrorCorrection !== "Q" &&
      candidate.qrErrorCorrection !== "H") ||
    typeof candidate.autoClearPlaintextAfterEncrypt !== "boolean" ||
    !Number.isSafeInteger(candidate.backgroundClearSeconds) ||
    candidate.backgroundClearSeconds === undefined ||
    candidate.backgroundClearSeconds < 0 ||
    candidate.backgroundClearSeconds > 86_400
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  return {
    defaultAlgorithm: candidate.defaultAlgorithm,
    qrErrorCorrection: candidate.qrErrorCorrection,
    autoClearPlaintextAfterEncrypt: candidate.autoClearPlaintextAfterEncrypt,
    backgroundClearSeconds: candidate.backgroundClearSeconds,
  }
}

export async function getPreferences(): Promise<Preferences> {
  try {
    const row = await (await getDb()).get(STORE_PREFERENCES, PREFERENCES_KEY)
    if (row === undefined) return defaults()
    if (typeof row.value !== "object" || row.value === null) {
      throw new AppError("STORAGE_FAILED")
    }
    return validatePreferences({ ...defaults(), ...row.value })
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function updatePreferences(
  patch: Partial<Preferences>,
): Promise<Preferences> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PREFERENCES, "readwrite")
    const row = await tx.store.get(PREFERENCES_KEY)
    let current: Preferences
    if (row === undefined) current = defaults()
    else if (typeof row.value === "object" && row.value !== null) {
      current = validatePreferences({ ...defaults(), ...row.value })
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
