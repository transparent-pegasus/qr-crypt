// Key-record persistence. Validate per-kind invariants at the write boundary.
import type { RotatedSymmetricKey } from "@/crypto/key-generation"
import type { StoredKeyRecord } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { keyNameSchema, validateStoredKeyRecord } from "@/schemas/key-schema"
import { getDb, STORE_KEYS, withSensitiveWriteLock } from "@/storage/database"

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

// Throw AppError("DUPLICATE_KEY") if an existing fingerprint (sha256Hex) matches.
// Only for a caller already inside withSensitiveWriteLock — the key-create path
// holds it across generation. Web Locks has no reentrancy, and a nested shared
// request would queue behind any exclusive request that arrived in between.
export async function writeKeyRecord(record: StoredKeyRecord): Promise<void> {
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

export function saveKeyRecord(record: StoredKeyRecord): Promise<void> {
  return withSensitiveWriteLock(() => writeKeyRecord(record))
}

// Descending createdAt order.
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

export async function getActiveKeyRecord(
  id: string,
): Promise<StoredKeyRecord | undefined> {
  const record = await getKeyRecord(id)
  return record?.status === "active" ? record : undefined
}

export function saveSymmetricRotation(rotated: RotatedSymmetricKey): Promise<void> {
  return withSensitiveWriteLock(async () => {
    const next = checkedRecord(rotated.next)
    const previous = checkedRecord(rotated.previous)
    if (
      next.status !== "active" ||
      previous.status !== "rotated" ||
      next.rotatedFromId !== previous.id ||
      previous.rotatedAt === undefined ||
      next.createdAt !== previous.rotatedAt
    ) {
      throw new AppError("STORAGE_FAILED")
    }
    try {
      const database = await getDb()
      const tx = database.transaction(STORE_KEYS, "readwrite")
      try {
        const persistedValue = await tx.store.get(previous.id)
        const persisted =
          persistedValue === undefined ? undefined : checkedRecord(persistedValue)
        if (
          persisted === undefined ||
          persisted.id !== previous.id ||
          persisted.status !== "active" ||
          persisted.fingerprint !== previous.fingerprint
        ) {
          tx.abort()
          throw new AppError("STORAGE_FAILED")
        }
        await tx.store.put(previous)
        await tx.store.add(next)
        await tx.done
      } catch (error) {
        try {
          await tx.done
        } catch {
          // The transaction's request failure already carries the public error.
        }
        throw error
      }
    } catch (error) {
      throw toAppError(error, "STORAGE_FAILED")
    }
  })
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

// Call only after successful encryption/decryption. Perform get → put in one
// readwrite transaction.
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
