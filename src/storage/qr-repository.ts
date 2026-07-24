// 保存済み QR アーティファクトの永続化(spec §14/§15)。
import type { StoredQrArtifact } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { qrNameSchema, validateStoredQrArtifact } from "@/schemas/key-schema"
import { getDb, STORE_QR_ARTIFACTS } from "@/storage/database"

export interface SaveQrArtifactOptions {
  // true のとき payloadSha256 重複を許可(UI の確認後の再保存用)
  allowDuplicate?: boolean
}

const ACTIVE_QR_ARTIFACT_KINDS = new Set([
  "symmetric-key",
  "public-key",
  "encrypted-private-key",
  "pq-public-identity",
  "pq-kem-public-key",
  "pq-dsa-public-key",
])

// This check intentionally runs before schema decoding and before getDb(). A caller
// that bypasses TypeScript therefore cannot cause a write transaction to be opened
// for any message artifact.
function assertActiveArtifactKind(value: unknown): void {
  try {
    if (
      typeof value !== "object" ||
      value === null ||
      !("kind" in value) ||
      typeof value.kind !== "string" ||
      !ACTIVE_QR_ARTIFACT_KINDS.has(value.kind)
    ) {
      throw new AppError("STORAGE_FAILED")
    }
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

function checkedArtifact(value: unknown): StoredQrArtifact {
  try {
    return validateStoredQrArtifact(value)
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

function safeArtifact(value: unknown): StoredQrArtifact | undefined {
  try {
    return validateStoredQrArtifact(value)
  } catch {
    return undefined
  }
}

// 単一 readwrite tx 内で by-payloadSha256 lookup → 判定 → add(plan §13 C9)。
// 重複かつ !allowDuplicate は AppError("DUPLICATE_QR")
export async function saveQrArtifact(
  artifact: StoredQrArtifact,
  options?: SaveQrArtifactOptions,
): Promise<void> {
  assertActiveArtifactKind(artifact)
  const checked = checkedArtifact(artifact)
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_QR_ARTIFACTS, "readwrite")
    const existing = await tx.store.index("by-payloadSha256").get(checked.payloadSha256)
    if (existing !== undefined && !(options?.allowDuplicate ?? false)) {
      throw new AppError("DUPLICATE_QR")
    }
    await tx.store.add(checked)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// createdAt 降順
export async function listQrArtifacts(): Promise<StoredQrArtifact[]> {
  try {
    const records = await (await getDb()).getAll(STORE_QR_ARTIFACTS)
    return records
      .map(safeArtifact)
      .filter((record): record is StoredQrArtifact => record !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findQrByPayloadSha256(
  sha256Hex: string,
): Promise<StoredQrArtifact | undefined> {
  try {
    const value = await (
      await getDb()
    ).getFromIndex(STORE_QR_ARTIFACTS, "by-payloadSha256", sha256Hex)
    return value === undefined ? undefined : checkedArtifact(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// qrNameSchema 検証済みの名前を渡す
export async function renameQrArtifact(id: string, name: string): Promise<void> {
  try {
    const parsedName = qrNameSchema.parse(name)
    const database = await getDb()
    const tx = database.transaction(STORE_QR_ARTIFACTS, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("STORAGE_FAILED")
    const updated = checkedArtifact({ ...existing, name: parsedName })
    await tx.store.put(updated)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function deleteQrArtifact(id: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE_QR_ARTIFACTS, id)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// QR 表示成功時のみ。単一 tx の get→put(plan §13 C21)
export async function markQrViewed(id: string, when: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_QR_ARTIFACTS, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("STORAGE_FAILED")
    const updated = checkedArtifact({ ...existing, lastViewedAt: when })
    await tx.store.put(updated)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function clearAllQrArtifacts(): Promise<void> {
  try {
    await (await getDb()).clear(STORE_QR_ARTIFACTS)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
