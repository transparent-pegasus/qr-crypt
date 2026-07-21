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

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// oldVersion < N のとき migrations[N] を昇順に適用する
export function applyMigrations(
  db: IDBPDatabase<OfflineCipherDb>,
  oldVersion: number,
  tx: Parameters<UpgradeFn>[1],
): void {
  notImplemented(db, oldVersion, tx)
}
