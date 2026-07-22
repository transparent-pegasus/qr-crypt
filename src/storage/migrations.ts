// IndexedDB スキーマの版別 upgrade マップ(plan §12-7 / §13 C26)。
// v1: 4 ストアと索引の作成。v2: PQ ストア追加と legacy ciphertext purge。
// fresh-create と段階 upgrade の両方が同じマップを通る。
import { unwrap } from "idb"
import type { IDBPDatabase, IDBPTransaction } from "idb"
import { validateLegacyStoredQrArtifactV1 } from "@/schemas/key-schema"
import { DB_VERSION, type OfflineCipherDb } from "@/storage/database"

type VersionchangeStore =
  | "keys"
  | "qrArtifacts"
  | "preferences"
  | "appMetadata"
  | "pqIdentities"
  | "pqPublicBundles"

export interface MigrationHooks {
  // Test/telemetry observer. It is synchronous and never awaited inside the
  // versionchange transaction.
  onCiphertextPurgeComplete?: (deletedCount: number) => void
  // Deterministic fail-closed seam for the migration abort integration test.
  beforeCiphertextPurgeDelete?: (value: unknown, deletedCount: number) => void
}

export type UpgradeRequestChain = IDBRequest<IDBCursorWithValue | null>

export type UpgradeFn = (
  db: IDBPDatabase<OfflineCipherDb>,
  tx: IDBPTransaction<OfflineCipherDb, ArrayLike<VersionchangeStore>, "versionchange">,
  hooks: MigrationHooks,
) => void | UpgradeRequestChain

function abortVersionchange(transaction: IDBTransaction): void {
  try {
    transaction.abort()
  } catch {
    // An already-aborted transaction needs no further action.
  }
}

function shouldPurgeLegacyArtifact(value: unknown): boolean {
  try {
    return validateLegacyStoredQrArtifactV1(value).kind === "ciphertext"
  } catch {
    // Rows that cannot be classified by the v1 boundary are not retained in v2.
    return true
  }
}

// Request callbacks are chained directly on the raw versionchange transaction.
// There is deliberately no promise/await boundary while the cursor is alive.
function purgeLegacyCiphertext(
  tx: Parameters<UpgradeFn>[1],
  hooks: MigrationHooks,
): IDBRequest<IDBCursorWithValue | null> {
  // The open request remains the authoritative upgrade result. Observe the idb
  // transaction wrapper as well so an intentional abort does not surface as a
  // second, unhandled rejection.
  void tx.done.catch(() => undefined)
  const transaction = unwrap(tx)
  const request = transaction.objectStore("qrArtifacts").openCursor()
  let deletedCount = 0

  request.onerror = () => abortVersionchange(transaction)
  request.onsuccess = () => {
    const cursor = request.result
    if (cursor === null) {
      try {
        hooks.onCiphertextPurgeComplete?.(deletedCount)
      } catch {
        abortVersionchange(transaction)
      }
      return
    }

    let purge: boolean
    try {
      purge = shouldPurgeLegacyArtifact(cursor.value)
      if (purge) hooks.beforeCiphertextPurgeDelete?.(cursor.value, deletedCount)
    } catch {
      abortVersionchange(transaction)
      return
    }

    if (!purge) {
      try {
        cursor.continue()
      } catch {
        abortVersionchange(transaction)
      }
      return
    }

    const deletion = cursor.delete()
    deletion.onerror = () => abortVersionchange(transaction)
    deletion.onsuccess = () => {
      deletedCount += 1
      try {
        cursor.continue()
      } catch {
        abortVersionchange(transaction)
      }
    }
  }
  return request
}

const migrations: Readonly<Record<number, UpgradeFn>> = {
  1: (db, tx) => {
    void tx
    const keys = db.createObjectStore("keys", { keyPath: "id" })
    keys.createIndex("by-fingerprint", "fingerprint", { unique: true })
    keys.createIndex("by-createdAt", "createdAt")

    const qrArtifacts = db.createObjectStore("qrArtifacts", {
      keyPath: "id",
    })
    qrArtifacts.createIndex("by-payloadSha256", "payloadSha256")
    qrArtifacts.createIndex("by-createdAt", "createdAt")

    db.createObjectStore("preferences", { keyPath: "key" })
    db.createObjectStore("appMetadata", { keyPath: "key" })
  },
  2: (db, tx, hooks) => {
    const identities = db.createObjectStore("pqIdentities", { keyPath: "id" })
    identities.createIndex("by-createdAt", "createdAt")
    identities.createIndex("by-kemKeyId", "kem.keyId", { unique: true })
    identities.createIndex("by-signingKeyId", "signing.keyId", { unique: true })

    const bundles = db.createObjectStore("pqPublicBundles", {
      keyPath: "recordId",
    })
    bundles.createIndex("by-identityId", "identityId", { unique: false })

    return purgeLegacyCiphertext(tx, hooks)
  },
}

// oldVersion < N のとき migrations[N] を昇順に適用する
export function applyMigrations(
  db: IDBPDatabase<OfflineCipherDb>,
  oldVersion: number,
  tx: Parameters<UpgradeFn>[1],
  hooks: MigrationHooks = {},
): void {
  for (let version = oldVersion + 1; version <= DB_VERSION; version += 1) {
    const migration = migrations[version]
    if (migration !== undefined) migration(db, tx, hooks)
  }
}
