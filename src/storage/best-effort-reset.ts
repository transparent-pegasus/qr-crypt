// ローカルデータのベストエフォート初期化(plan2.1 §B3/§B4 — WP-BOOT)。
// 名称に "secure" / "wipe" を使わない(物理消去は保証不能: LevelDB 追記型・
// SSD ウェアレベリング。確実な消去は端末の完全フォーマットのみ)。
//
// 順序(WipeCoordinator が単一所有。凍結):
//   1. 新規 UI/crypto/storage 操作を fail-closed
//   2. Worker cancel/terminate、app 所有秘密バッファーと Vault 鍵キャッシュ drop
//   3. transient/SensitiveSession を非表示・reset
//   4. navigator.locks(fallback あり)+ BroadcastChannel("qrypt-wipe")で
//      全タブへ停止/close 要求
//   5. Vault 配下の EncryptedSecret を先に削除 → Vault 鍵レコード削除
//      (暗号シュレッディング。非抽出 CryptoKey の byte 上書きは主張しない)
//   6. 全 DB(pqIdentities/pqPublicBundles 含む)+ oc-* localStorage を削除
//   7. DB 不在を再確認して barrier 維持(deleteDB({blocked}) に timeout+UI)
//
// churn(resetChurnMb)は既定 0 の実験オプション。消去保証にならない
// (idle/quota 上限/AbortSignal/失敗記録付き。QuotaExceeded は握って続行)。
import { deleteDB, openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { RESET_CHURN_MB_MAX, RESET_CHURN_MB_MIN } from "@/lib/limits"
import { DB_NAME, databaseExists, deleteEntireDatabase } from "@/storage/database"

const VAULT_KEY_METADATA_KEY = "vault-key"
const STORE_APP_METADATA = "appMetadata"
const VAULT_ENCRYPTED_SECRET_STORES = ["pqIdentities"] as const

export const RESET_CHURN_DATABASE_NAME = "qrypt-reset-churn"
export const RESET_CHURN_CHUNK_BYTES = 1024 * 1024
const RANDOM_FILL_CHUNK_BYTES = 65_536

export interface BestEffortResetArgs {
  reason: "online-detected" | "user-requested"
  resetChurnMb: number // 0–512(limits.ts)
  signal?: AbortSignal
}

export interface BestEffortResetReport {
  ok: boolean
  // 完了表示は「論理削除を試行しました(物理消去は未保証)」。
  // 部分失敗は成功文言にせず RESET_FAILED として提示する
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
  storage: Storage | undefined =
    typeof window === "undefined" ? undefined : window.localStorage,
): void {
  if (!storage) return
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key?.startsWith("oc-")) keys.push(key)
  }
  for (const key of keys) storage.removeItem(key)
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

  void args.reason
  return { ok: failedSteps.length === 0, failedSteps }
}
