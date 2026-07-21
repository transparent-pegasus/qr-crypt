// 保存済み QR アーティファクトの永続化(spec §14/§15)。
import type { StoredQrArtifact } from "@/schemas/domain"

export interface SaveQrArtifactOptions {
  // true のとき payloadSha256 重複を許可(UI の確認後の再保存用)
  allowDuplicate?: boolean
}

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

// 単一 readwrite tx 内で by-payloadSha256 lookup → 判定 → add(plan §13 C9)。
// 重複かつ !allowDuplicate は AppError("DUPLICATE_QR")
export function saveQrArtifact(
  artifact: StoredQrArtifact,
  options?: SaveQrArtifactOptions,
): Promise<void> {
  return notImplemented(artifact, options)
}

// createdAt 降順
export function listQrArtifacts(): Promise<StoredQrArtifact[]> {
  return notImplemented()
}

export function findQrByPayloadSha256(
  sha256Hex: string,
): Promise<StoredQrArtifact | undefined> {
  return notImplemented(sha256Hex)
}

// qrNameSchema 検証済みの名前を渡す
export function renameQrArtifact(id: string, name: string): Promise<void> {
  return notImplemented(id, name)
}

export function deleteQrArtifact(id: string): Promise<void> {
  return notImplemented(id)
}

// QR 表示成功時のみ。単一 tx の get→put(plan §13 C21)
export function markQrViewed(id: string, when: number): Promise<void> {
  return notImplemented(id, when)
}

export function clearAllQrArtifacts(): Promise<void> {
  return notImplemented()
}
