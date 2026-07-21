// IndexedDB スキーマの版別 upgrade マップ(plan §12-7 / §13 C26)。
// v1: 4 ストアと索引の作成。将来の v2 はこのマップへ追記する
// (migration harness の拡張点。fresh-create と区別してテストする)。
import type { IDBPDatabase, IDBPTransaction } from "idb"
import type { OfflineCipherDb } from "@/storage/database"

export type UpgradeFn = (
  db: IDBPDatabase<OfflineCipherDb>,
  tx: IDBPTransaction<
    OfflineCipherDb,
    ArrayLike<"keys" | "qrArtifacts" | "preferences" | "appMetadata">,
    "versionchange"
  >,
) => void

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
}

// oldVersion < N のとき migrations[N] を昇順に適用する
export function applyMigrations(
  db: IDBPDatabase<OfflineCipherDb>,
  oldVersion: number,
  tx: Parameters<UpgradeFn>[1],
): void {
  for (let version = oldVersion + 1; version <= 1; version += 1) {
    const migration = migrations[version]
    if (migration !== undefined) migration(db, tx)
  }
}
