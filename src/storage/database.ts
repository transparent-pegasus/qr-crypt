// IndexedDB connection. For schema changes, increment DB_VERSION;
// during upgrade, delete all old object stores and recreate the current schema.
// There is no incremental migration: all old data is discarded.
import { deleteDB, openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { AppError, toAppError } from "@/crypto/errors"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
  StoredKeyRecord,
} from "@/schemas/domain"

export const DB_NAME = "qr-crypt"
export const DB_VERSION = 4

export const STORE_KEYS = "keys"
export const STORE_PREFERENCES = "preferences"
export const STORE_APP_METADATA = "appMetadata"
export const STORE_PQ_IDENTITIES = "pqIdentities"
export const STORE_PQ_PUBLIC_BUNDLES = "pqPublicBundles"

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
  preferences: { key: string; value: KeyValueRow }
  appMetadata: { key: string; value: KeyValueRow }
  pqIdentities: {
    key: string
    value: PostQuantumIdentity
    indexes: {
      "by-createdAt": number
      "by-kemKeyId": string
      "by-signingKeyId": string
    }
  }
  pqPublicBundles: {
    key: string
    value: PqPublicBundleRecord
    indexes: {
      "by-identityId": string
      "by-signingKeyId": string
      "by-kemKeyId": string
    }
  }
}

let databasePromise: Promise<IDBPDatabase<OfflineCipherDb>> | undefined
let databaseInstance: IDBPDatabase<OfflineCipherDb> | undefined
let databaseAccessBarrier = false

export const DATABASE_DELETE_TIMEOUT_MS = 3_000
export const DATABASE_OPEN_BLOCKED_TIMEOUT_MS = 3_000

export interface DeleteEntireDatabaseOptions {
  timeoutMs?: number
  onBlocked?: () => void
}

export interface GetDatabaseOptions {
  timeoutMs?: number
  onBlocked?: () => void
  onBlocking?: () => void
}

// WipeCoordinator step 1. This barrier is intentionally one-way in production.
export function engageDatabaseAccessBarrier(): void {
  databaseAccessBarrier = true
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

// Boot proves the origin holds no sensitive data before it authorizes the online
// relay, and that proof is only worth anything if nothing can write while it is
// being taken. A counter cannot give that: a writer still inside Web Crypto has
// already incremented it, and a peer tab's writes never touch this realm's
// variables at all. Web Locks are origin-wide, so an exclusive holder waits out
// every writer wherever it started and keeps the next one out until the decision
// is published.
export const SENSITIVE_WRITE_LOCK = "qr-crypt-sensitive-write"

function lockManager(): LockManager | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.locks
}

// Writers hold it shared: they do not exclude each other, only the proof.
export async function withSensitiveWriteLock<T>(operation: () => Promise<T>): Promise<T> {
  const locks = lockManager()
  if (locks === undefined) return operation()
  return locks.request(SENSITIVE_WRITE_LOCK, { mode: "shared" }, operation)
}

// The callback is told whether the lock was actually taken. Without Web Locks the
// origin cannot be proved clean, but the wipe decision still has to be made, so
// the operation runs either way and the caller fails closed on false.
export function withSensitiveWritesExcluded(
  operation: (exclusive: boolean) => Promise<void>,
): Promise<void> {
  const locks = lockManager()
  if (locks === undefined) return operation(false)
  return locks.request(SENSITIVE_WRITE_LOCK, { mode: "exclusive" }, () => operation(true))
}

function timeoutOrDefault(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value < 0) throw new AppError("STORAGE_FAILED")
  return value
}

function openApplicationDatabase(
  options: GetDatabaseOptions,
): Promise<IDBPDatabase<OfflineCipherDb>> {
  const timeoutMs = timeoutOrDefault(options.timeoutMs, DATABASE_OPEN_BLOCKED_TIMEOUT_MS)
  return new Promise((resolve, reject) => {
    let settled = false
    let blockedTimeoutId: ReturnType<typeof setTimeout> | undefined
    const clearBlockedTimeout = () => {
      if (blockedTimeoutId !== undefined) clearTimeout(blockedTimeoutId)
      blockedTimeoutId = undefined
    }
    const opening = openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
      upgrade(database, oldVersion) {
        if (oldVersion !== 0) {
          for (const name of Array.from(database.objectStoreNames)) {
            database.deleteObjectStore(name)
          }
        }
        const keys = database.createObjectStore(STORE_KEYS, { keyPath: "id" })
        keys.createIndex("by-fingerprint", "fingerprint", { unique: true })
        keys.createIndex("by-createdAt", "createdAt")

        database.createObjectStore(STORE_PREFERENCES, { keyPath: "key" })
        database.createObjectStore(STORE_APP_METADATA, { keyPath: "key" })

        const identities = database.createObjectStore(STORE_PQ_IDENTITIES, {
          keyPath: "id",
        })
        identities.createIndex("by-createdAt", "createdAt")
        identities.createIndex("by-kemKeyId", "kem.keyId", { unique: true })
        identities.createIndex("by-signingKeyId", "signing.keyId", {
          unique: true,
        })

        const bundles = database.createObjectStore(STORE_PQ_PUBLIC_BUNDLES, {
          keyPath: "recordId",
        })
        bundles.createIndex("by-identityId", "identityId")
        bundles.createIndex("by-signingKeyId", "signing.keyId", { unique: true })
        bundles.createIndex("by-kemKeyId", "kem.keyId", { unique: true })
      },
      blocked() {
        try {
          options.onBlocked?.()
        } catch {
          // Notification callbacks cannot weaken the storage fail-closed path.
        }
        blockedTimeoutId ??= setTimeout(() => {
          if (settled) return
          settled = true
          reject(new AppError("RESET_FAILED"))
        }, timeoutMs)
      },
      blocking() {
        try {
          options.onBlocking?.()
        } catch {
          // Closing this connection is mandatory even if notification code fails.
        } finally {
          closeDb()
        }
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

export async function getDb(
  options: GetDatabaseOptions = {},
): Promise<IDBPDatabase<OfflineCipherDb>> {
  assertDatabaseAccessAllowed()
  databasePromise ??= openApplicationDatabase(options)
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

// Used by the settings page to reset all local data. Service-worker caches are excluded.
export async function deleteEntireDatabase(
  options: DeleteEntireDatabaseOptions = {},
): Promise<void> {
  const timeoutMs = timeoutOrDefault(options.timeoutMs, DATABASE_DELETE_TIMEOUT_MS)
  let timeoutId: ReturnType<typeof setTimeout> | undefined
  let blocked = false
  try {
    closeDb()
    const deletion = deleteDB(DB_NAME, {
      blocked() {
        blocked = true
        try {
          options.onBlocked?.()
        } catch {
          // The timeout remains authoritative even if a UI observer fails.
        }
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
