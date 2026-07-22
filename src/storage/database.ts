// IndexedDB 接続(spec §15)。DB 名 qrypt / version 1。
// upgrade 処理は migrations.ts の版別マップに委譲する(plan §12-7)。
import { deleteDB, openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { AppError, toAppError } from "@/crypto/errors"
import type { StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"
import { applyMigrations } from "@/storage/migrations"

export const DB_NAME = "qrypt"
export const DB_VERSION = 1

export const STORE_KEYS = "keys"
export const STORE_QR_ARTIFACTS = "qrArtifacts"
export const STORE_PREFERENCES = "preferences"
export const STORE_APP_METADATA = "appMetadata"

export interface KeyValueRow {
  key: string
  value: unknown
}

export interface OfflineCipherDb extends DBSchema {
  keys: {
    key: string
    value: StoredKeyRecord
    indexes: { "by-fingerprint": string; "by-createdAt": number }
  }
  qrArtifacts: {
    key: string
    value: StoredQrArtifact
    // by-payloadSha256 は非 unique(意図的な重複保存を許可。plan §13 C9)
    indexes: { "by-payloadSha256": string; "by-createdAt": number }
  }
  preferences: { key: string; value: KeyValueRow }
  appMetadata: { key: string; value: KeyValueRow }
}

let databasePromise: Promise<IDBPDatabase<OfflineCipherDb>> | undefined
let databaseInstance: IDBPDatabase<OfflineCipherDb> | undefined
let databaseAccessBarrier = false

export const DATABASE_DELETE_TIMEOUT_MS = 3_000
export const DATABASE_OPEN_BLOCKED_TIMEOUT_MS = 3_000

export interface DeleteEntireDatabaseOptions {
  timeoutMs?: number
}

// WipeCoordinator step 1. This barrier is intentionally one-way in production.
export function engageDatabaseAccessBarrier(): void {
  databaseAccessBarrier = true
}

export function isDatabaseAccessBarrierEngaged(): boolean {
  return databaseAccessBarrier
}

export function assertDatabaseAccessAllowed(): void {
  if (databaseAccessBarrier) throw new AppError("RESET_FAILED")
}

// Test isolation only; the application has no supported path that lowers the barrier.
export function resetDatabaseAccessBarrierForTesting(): void {
  if (typeof process === "undefined" || process.env.NODE_ENV !== "test") {
    throw new AppError("RESET_FAILED")
  }
  databaseAccessBarrier = false
}

function openApplicationDatabase(): Promise<IDBPDatabase<OfflineCipherDb>> {
  return new Promise((resolve, reject) => {
    let settled = false
    let blockedTimeoutId: ReturnType<typeof setTimeout> | undefined
    const clearBlockedTimeout = () => {
      if (blockedTimeoutId !== undefined) clearTimeout(blockedTimeoutId)
      blockedTimeoutId = undefined
    }
    const opening = openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion, _newVersion, transaction) {
        applyMigrations(database, oldVersion, transaction)
      },
      blocked() {
        blockedTimeoutId ??= setTimeout(() => {
          if (settled) return
          settled = true
          reject(new AppError("RESET_FAILED"))
        }, DATABASE_OPEN_BLOCKED_TIMEOUT_MS)
      },
      blocking() {
        closeDb()
      },
      terminated() {
        databaseInstance = undefined
        databasePromise = undefined
      },
    })
    void opening.then(
      (database) => {
        clearBlockedTimeout()
        if (settled) {
          database.close()
          return
        }
        settled = true
        resolve(database)
      },
      (error: unknown) => {
        clearBlockedTimeout()
        if (settled) return
        settled = true
        reject(error)
      },
    )
  })
}

export async function getDb(): Promise<IDBPDatabase<OfflineCipherDb>> {
  assertDatabaseAccessAllowed()
  databasePromise ??= openApplicationDatabase()
  try {
    const database = await databasePromise
    if (databaseAccessBarrier) {
      database.close()
      databaseInstance = undefined
      databasePromise = undefined
      throw new AppError("RESET_FAILED")
    }
    databaseInstance = database
    return database
  } catch (error) {
    databasePromise = undefined
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export function closeDb(): void {
  if (databasePromise === undefined) return
  if (databaseInstance !== undefined) databaseInstance.close()
  else void databasePromise.then((database) => database.close()).catch(() => undefined)
  databaseInstance = undefined
  databasePromise = undefined
}

// 全ローカルデータ初期化用(設定ページ)。SW キャッシュは対象外(plan §13 C21)
export async function deleteEntireDatabase(
  options: DeleteEntireDatabaseOptions = {},
): Promise<void> {
  const timeoutMs = Math.max(0, options.timeoutMs ?? DATABASE_DELETE_TIMEOUT_MS)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let blocked = false
  try {
    closeDb()
    const deletion = deleteDB(DB_NAME, {
      blocked() {
        blocked = true
      },
    })
    await Promise.race([
      deletion,
      new Promise<never>((_resolve, reject) => {
        timeoutId = setTimeout(() => reject(new AppError("RESET_FAILED")), timeoutMs)
      }),
    ])
  } catch (error) {
    if (blocked || error instanceof AppError) {
      throw error instanceof AppError ? error : new AppError("RESET_FAILED")
    }
    throw toAppError(error, "STORAGE_FAILED")
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    databaseInstance = undefined
    databasePromise = undefined
  }
}

// Step 7 verification. The raw open is aborted when it would create a missing DB.
export async function databaseExists(databaseName = DB_NAME): Promise<boolean> {
  if (typeof indexedDB.databases === "function") {
    try {
      return (await indexedDB.databases()).some(({ name }) => name === databaseName)
    } catch {
      // Fall through to a non-creating open probe.
    }
  }

  return new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open(databaseName)
    let wouldCreate = false
    request.onupgradeneeded = () => {
      wouldCreate = true
      request.transaction?.abort()
    }
    request.onsuccess = () => {
      request.result.close()
      resolve(true)
    }
    request.onerror = () => {
      if (wouldCreate && request.error?.name === "AbortError") {
        resolve(false)
        return
      }
      reject(new AppError("RESET_FAILED"))
    }
    request.onblocked = () => reject(new AppError("RESET_FAILED"))
  })
}
