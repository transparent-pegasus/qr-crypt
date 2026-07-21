// 鍵レコードの永続化(spec §10/§15)。
// 書込境界で kind 別不変条件を検証する(plan §13 C13)。
import type { StoredKeyRecord } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { keyNameSchema, validateStoredKeyRecord } from "@/schemas/key-schema"
import { getDb, STORE_KEYS } from "@/storage/database"

function checkedRecord(value: unknown): StoredKeyRecord {
  try {
    return validateStoredKeyRecord(value)
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

function safeRecord(value: unknown): StoredKeyRecord | undefined {
  try {
    return validateStoredKeyRecord(value)
  } catch {
    return undefined
  }
}

// 指紋(sha256Hex)一致が既存にあれば AppError("DUPLICATE_KEY")
export async function saveKeyRecord(record: StoredKeyRecord): Promise<void> {
  const checked = checkedRecord(record)
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_KEYS, "readwrite")
    const existing = await tx.store.index("by-fingerprint").get(checked.fingerprint)
    if (existing !== undefined) {
      throw new AppError("DUPLICATE_KEY")
    }
    await tx.store.add(checked)
    await tx.done
  } catch (error) {
    if (error instanceof AppError) throw error
    if (error instanceof DOMException && error.name === "ConstraintError") {
      throw new AppError("DUPLICATE_KEY")
    }
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// createdAt 降順
export async function listKeyRecords(): Promise<StoredKeyRecord[]> {
  try {
    const records = await (await getDb()).getAll(STORE_KEYS)
    return records
      .map(safeRecord)
      .filter((record): record is StoredKeyRecord => record !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function getKeyRecord(id: string): Promise<StoredKeyRecord | undefined> {
  try {
    const value = await (await getDb()).get(STORE_KEYS, id)
    return value === undefined ? undefined : checkedRecord(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findKeyByFingerprint(
  sha256Hex: string,
): Promise<StoredKeyRecord | undefined> {
  try {
    const value = await (
      await getDb()
    ).getFromIndex(STORE_KEYS, "by-fingerprint", sha256Hex)
    return value === undefined ? undefined : checkedRecord(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function renameKeyRecord(id: string, name: string): Promise<void> {
  try {
    const parsedName = keyNameSchema.parse(name)
    const database = await getDb()
    const tx = database.transaction(STORE_KEYS, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    const updated = checkedRecord({ ...existing, name: parsedName })
    await tx.store.put(updated)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function deleteKeyRecord(id: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE_KEYS, id)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// 暗号化/復号の成功後のみ呼ぶ。単一 readwrite tx の get→put(plan §13 C21)
export async function markKeyUsed(id: string, when: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_KEYS, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    const updated = checkedRecord({
      ...existing,
      useCount: existing.useCount + 1,
      lastUsedAt: when,
    })
    await tx.store.put(updated)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function clearAllKeys(): Promise<void> {
  try {
    await (await getDb()).clear(STORE_KEYS)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
