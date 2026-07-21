// IndexedDB 接続(spec §15)。DB 名 offline-cipher / version 1。
// upgrade 処理は migrations.ts の版別マップに委譲する(plan §12-7)。
import type { DBSchema, IDBPDatabase } from "idb"
import type { StoredKeyRecord, StoredQrArtifact } from "@/schemas/domain"

export const DB_NAME = "offline-cipher"
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

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function getDb(): Promise<IDBPDatabase<OfflineCipherDb>> {
  return notImplemented()
}

export function closeDb(): void {
  notImplemented()
}

// 全ローカルデータ初期化用(設定ページ)。SW キャッシュは対象外(plan §13 C21)
export function deleteEntireDatabase(): Promise<void> {
  return notImplemented()
}
