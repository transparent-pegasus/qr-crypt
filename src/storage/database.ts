// IndexedDB 接続(spec §15)。DB 名 qrypt / version 1。
// upgrade 処理は migrations.ts の版別マップに委譲する(plan §12-7)。
import { deleteDB, openDB } from "idb"
import type { DBSchema, IDBPDatabase } from "idb"
import { toAppError } from "@/crypto/errors"
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

export async function getDb(): Promise<IDBPDatabase<OfflineCipherDb>> {
  databasePromise ??= openDB<OfflineCipherDb>(DB_NAME, DB_VERSION, {
    upgrade(database, oldVersion, _newVersion, transaction) {
      applyMigrations(database, oldVersion, transaction)
    },
    terminated() {
      databaseInstance = undefined
      databasePromise = undefined
    },
  })
  try {
    const database = await databasePromise
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
export async function deleteEntireDatabase(): Promise<void> {
  try {
    if (databasePromise !== undefined) {
      const database = await databasePromise
      database.close()
      databaseInstance = undefined
      databasePromise = undefined
    }
    await deleteDB(DB_NAME)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
