// 鍵レコードの永続化(spec §10/§15)。
// 書込境界で kind 別不変条件を検証する(plan §13 C13)。
import type { StoredKeyRecord } from "@/schemas/domain"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// 指紋(sha256Hex)一致が既存にあれば AppError("DUPLICATE_KEY")
export function saveKeyRecord(record: StoredKeyRecord): Promise<void> {
  return notImplemented(record)
}

// createdAt 降順
export function listKeyRecords(): Promise<StoredKeyRecord[]> {
  return notImplemented()
}

export function getKeyRecord(
  id: string,
): Promise<StoredKeyRecord | undefined> {
  return notImplemented(id)
}

export function findKeyByFingerprint(
  sha256Hex: string,
): Promise<StoredKeyRecord | undefined> {
  return notImplemented(sha256Hex)
}

export function renameKeyRecord(id: string, name: string): Promise<void> {
  return notImplemented(id, name)
}

export function deleteKeyRecord(id: string): Promise<void> {
  return notImplemented(id)
}

// 暗号化/復号の成功後のみ呼ぶ。単一 readwrite tx の get→put(plan §13 C21)
export function markKeyUsed(id: string, when: number): Promise<void> {
  return notImplemented(id, when)
}

export function clearAllKeys(): Promise<void> {
  return notImplemented()
}
