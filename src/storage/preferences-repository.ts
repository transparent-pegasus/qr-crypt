// 設定の永続化(spec §28、オーナー決定による既定変更):
// defaultAlgorithm/qrErrorCorrection = env、平文自動消去は両方 true。
// 遅延は設定として保存せず env.autoClearSeconds の固定値を使う。
import type { Preferences } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { env } from "@/schemas/env-schema"
import { getDb, STORE_PREFERENCES, type KeyValueRow } from "@/storage/database"

const PREFERENCES_KEY = "preferences"

function defaults(): Preferences {
  return {
    defaultAlgorithm: env.defaultAlgorithm,
    qrErrorCorrection: env.qrErrorCorrection,
    autoClearPlaintextAfterEncrypt: true,
    backgroundClearEnabled: true,
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
    typeof candidate.backgroundClearEnabled !== "boolean"
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  return {
    defaultAlgorithm: candidate.defaultAlgorithm,
    qrErrorCorrection: candidate.qrErrorCorrection,
    autoClearPlaintextAfterEncrypt: candidate.autoClearPlaintextAfterEncrypt,
    backgroundClearEnabled: candidate.backgroundClearEnabled,
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
