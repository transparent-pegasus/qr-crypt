// Best-effort local-data reset; see docs/spec/boot-and-reset-v2.md §4 and §5.
// Do not use "secure" or "wipe" in its name. Physical erasure cannot be assured because
// LevelDB is append-oriented and SSDs use wear leveling; complete device formatting is
// the only reliable erasure path.
//
// Order (owned solely by WipeCoordinator; frozen):
//   1. Fail closed for new UI/crypto/storage operations.
//   2. Cancel/terminate Workers and drop application-owned secret buffers and the
//      Vault-key cache.
//   3. Hide and reset transient state/SensitiveSession.
//   4. Use navigator.locks (with a fallback) plus BroadcastChannel("qr-crypt-wipe")
//      to request that all tabs stop and close.
//   5. Delete EncryptedSecret values under the Vault first, then delete the Vault-key
//      record. This is cryptographic shredding; do not claim to overwrite bytes in a
//      non-extractable CryptoKey.
//   6. Delete every database, including pqIdentities/pqPublicBundles, plus oc-* localStorage.
//      Only for online-detected, immediately restore the acknowledgement marker before
//      publishing the terminal state.
//   7. Reconfirm database absence and keep the barrier in place; deleteDB({blocked})
//      has a timeout and UI handling.
//
// churn (resetChurnMb) is an experimental option defaulting to 0 and does not assure
// erasure. It has idle/quota bounds, AbortSignal support, and failure recording;
// tolerate QuotaExceeded and continue.
import { deleteDB, openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { RESET_CHURN_MB_MAX, RESET_CHURN_MB_MIN } from "@/lib/limits"
import { DB_NAME, databaseExists, deleteEntireDatabase } from "@/storage/database"
import { setAckPending } from "@/app/offline-ack-marker"
import { OC_LOCAL_STORAGE_CLEARED_EVENT } from "@/storage/reset-events"

const VAULT_KEY_METADATA_KEY = "vault-key"
const STORE_APP_METADATA = "appMetadata"
const VAULT_ENCRYPTED_SECRET_STORES = ["pqIdentities"] as const

export const RESET_CHURN_DATABASE_NAME = "qr-crypt-reset-churn"
export const RESET_CHURN_CHUNK_BYTES = 1024 * 1024
const RANDOM_FILL_CHUNK_BYTES = 65_536

export interface BestEffortResetArgs {
  reason: "online-detected" | "user-requested"
  resetChurnMb: number // 0–512(limits.ts)
  signal?: AbortSignal
}

export interface BestEffortResetReport {
  ok: boolean
  // Completion copy says, "Logical deletion was attempted (physical erasure is not assured)."
  // Present partial failures as RESET_FAILED, never with success wording.
  failedSteps: readonly string[]
}

export interface ResetChurnReport {
  aborted: boolean
  quotaExceeded: boolean
  writtenBytes: number
}

export interface BestEffortResetDependencies {
  clearLocalStorage: () => void | Promise<void>
  deleteDatabase: () => Promise<void>
  deleteVaultEncryptedSecrets: () => Promise<void>
  deleteVaultKey: () => Promise<void>
  runChurn: (megabytes: number, signal?: AbortSignal) => Promise<ResetChurnReport>
  verifyDatabaseAbsent: () => Promise<boolean>
}

interface ChurnDb extends DBSchema {
  chunks: {
    key: number
    value: { id: number; bytes: Uint8Array }
  }
}

interface DynamicDatabase {
  clear(storeName: string): Promise<void>
  close(): void
  delete(storeName: string, key: IDBValidKey): Promise<void>
  objectStoreNames: DOMStringList
}

function boundedChurnMegabytes(megabytes: number): number {
  if (!Number.isFinite(megabytes)) return 0
  return Math.min(RESET_CHURN_MB_MAX, Math.max(RESET_CHURN_MB_MIN, Math.trunc(megabytes)))
}

function boundedChurnBytes(megabytes: number): number {
  return boundedChurnMegabytes(megabytes) * 1024 * 1024
}

function quotaExceeded(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "QuotaExceededError") ||
    (typeof error === "object" &&
      error !== null &&
      "name" in error &&
      error.name === "QuotaExceededError")
  )
}

function fillRandom(bytes: Uint8Array<ArrayBuffer>): void {
  for (let offset = 0; offset < bytes.byteLength; offset += RANDOM_FILL_CHUNK_BYTES) {
    const length = Math.min(RANDOM_FILL_CHUNK_BYTES, bytes.length - offset)
    const view = new Uint8Array(bytes.buffer, offset, length)
    globalThis.crypto.getRandomValues(view)
  }
}

async function waitForIdle(signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return false
  if (typeof requestIdleCallback !== "function") {
    await Promise.resolve()
    return !signal?.aborted
  }

  return new Promise<boolean>((resolve) => {
    let settled = false
    function finish(result: boolean) {
      if (settled) return
      settled = true
      signal?.removeEventListener("abort", abort)
      resolve(result)
    }
    function abort() {
      cancelIdleCallback(idleId)
      finish(false)
    }
    const idleId = requestIdleCallback(() => finish(true), { timeout: 50 })
    if (!settled) {
      signal?.addEventListener("abort", abort, { once: true })
      if (signal?.aborted) abort()
    }
  })
}

/** Optional experimental storage churn. It does not claim physical erasure. */
export async function runResetChurn(
  megabytes: number,
  signal?: AbortSignal,
): Promise<ResetChurnReport> {
  const targetBytes = boundedChurnBytes(megabytes)
  if (targetBytes === 0) {
    return { aborted: false, quotaExceeded: false, writtenBytes: 0 }
  }

  let database: IDBPDatabase<ChurnDb> | undefined
  let writtenBytes = 0
  let wasQuotaExceeded = false
  let aborted = false
  try {
    database = await openDB<ChurnDb>(RESET_CHURN_DATABASE_NAME, 1, {
      upgrade(churnDatabase) {
        if (!churnDatabase.objectStoreNames.contains("chunks")) {
          churnDatabase.createObjectStore("chunks", { keyPath: "id" })
        }
      },
    })

    for (let id = 0; writtenBytes < targetBytes; id += 1) {
      if (!(await waitForIdle(signal))) {
        aborted = true
        break
      }
      const byteLength = Math.min(RESET_CHURN_CHUNK_BYTES, targetBytes - writtenBytes)
      const bytes = new Uint8Array(byteLength)
      try {
        fillRandom(bytes)
        await database.put("chunks", { id, bytes })
        writtenBytes += byteLength
      } catch (error) {
        if (quotaExceeded(error)) {
          wasQuotaExceeded = true
          break
        }
        throw error
      } finally {
        bytes.fill(0)
      }
    }
  } finally {
    database?.close()
    await deleteDB(RESET_CHURN_DATABASE_NAME)
  }

  return { aborted, quotaExceeded: wasQuotaExceeded, writtenBytes }
}

async function openExistingApplicationDatabase(): Promise<DynamicDatabase | undefined> {
  if (!(await databaseExists(DB_NAME))) return undefined
  return (await openDB(DB_NAME)) as unknown as DynamicDatabase
}

export async function deleteVaultEncryptedSecretRows(): Promise<void> {
  const database = await openExistingApplicationDatabase()
  if (!database) return
  try {
    for (const storeName of VAULT_ENCRYPTED_SECRET_STORES) {
      if (database.objectStoreNames.contains(storeName)) {
        await database.clear(storeName)
      }
    }
  } finally {
    database.close()
  }
}

export async function deleteVaultKeyRecord(): Promise<void> {
  const database = await openExistingApplicationDatabase()
  if (!database) return
  try {
    if (database.objectStoreNames.contains(STORE_APP_METADATA)) {
      await database.delete(STORE_APP_METADATA, VAULT_KEY_METADATA_KEY)
    }
  } finally {
    database.close()
  }
}

export function clearOcLocalStorage(
  storage: Storage | undefined = typeof window === "undefined"
    ? undefined
    : window.localStorage,
): void {
  if (!storage) return
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith("oc-")) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)

  try {
    if (typeof window !== "undefined" && storage === window.localStorage) {
      window.dispatchEvent(new Event(OC_LOCAL_STORAGE_CLEARED_EVENT))
    }
  } catch {
    // Storage deletion succeeded; notification is best-effort for mounted UI state.
  }
}

const DEFAULT_DEPENDENCIES: BestEffortResetDependencies = {
  clearLocalStorage: clearOcLocalStorage,
  deleteDatabase: deleteEntireDatabase,
  deleteVaultEncryptedSecrets: deleteVaultEncryptedSecretRows,
  deleteVaultKey: deleteVaultKeyRecord,
  runChurn: runResetChurn,
  verifyDatabaseAbsent: () => databaseExists(DB_NAME),
}

export async function bestEffortLocalReset(
  args: BestEffortResetArgs,
  overrides: Partial<BestEffortResetDependencies> = {},
): Promise<BestEffortResetReport> {
  const dependencies = { ...DEFAULT_DEPENDENCIES, ...overrides }
  const failedSteps: string[] = []
  const attempt = async (step: string, operation: () => void | Promise<void>) => {
    try {
      await operation()
    } catch {
      failedSteps.push(step)
    }
  }

  // Step 5: ciphertext-bearing identity rows must go before the Vault key row.
  await attempt("vault-encrypted-secrets", dependencies.deleteVaultEncryptedSecrets)
  await attempt("vault-key", dependencies.deleteVaultKey)

  // Step 6: logical deletion. Churn is optional, bounded, and runs only after it.
  await attempt("database", dependencies.deleteDatabase)
  await attempt("local-storage", dependencies.clearLocalStorage)
  if (args.reason === "online-detected") {
    // clearOcLocalStorage removes the old marker. Re-establish it before the
    // controller can publish wiped: online contact itself requires approval.
    setAckPending()
  }
  const resetChurnMb = boundedChurnMegabytes(args.resetChurnMb)
  if (resetChurnMb > 0) {
    await attempt("churn", async () => {
      const report = await dependencies.runChurn(resetChurnMb, args.signal)
      if (report.aborted || report.quotaExceeded) throw new Error("churn incomplete")
    })
  }

  // Step 7: deletion is not reported as complete while the application DB exists.
  await attempt("database-verification", async () => {
    if (await dependencies.verifyDatabaseAbsent()) {
      throw new Error("database remains")
    }
  })
  return { ok: failedSteps.length === 0, failedSteps }
}
