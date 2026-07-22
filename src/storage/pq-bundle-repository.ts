// pqPublicBundles ストアの CRUD(plan2.1 §E2/§E5 — WP-13)。
// keyPath: recordId / index: by-identityId(non-unique)。
//
// 規則(凍結):
//   - 暗号化の受信者選択は revokedAt 無しのレコードのみ
//   - 署名検証鍵の解決は signing.keyId で全レコード探索(revoked は未知鍵扱い)
//   - trust("unverified" | "fingerprint-confirmed")の遷移は
//     指紋比較画面の確認操作のみが行う(取込時は必ず unverified)
import type { PqPublicBundleRecord } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { validatePqPublicBundleRecord } from "@/schemas/key-schema"
import { getDb, STORE_PQ_PUBLIC_BUNDLES } from "@/storage/database"

function checkedBundle(value: unknown): PqPublicBundleRecord {
  try {
    return validatePqPublicBundleRecord(value)
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

function safeBundle(value: unknown): PqPublicBundleRecord | undefined {
  try {
    return validatePqPublicBundleRecord(value)
  } catch {
    return undefined
  }
}

async function usableBundles(): Promise<PqPublicBundleRecord[]> {
  return (await (await getDb()).getAll(STORE_PQ_PUBLIC_BUNDLES))
    .map(safeBundle)
    .filter(
      (record): record is PqPublicBundleRecord =>
        record !== undefined && record.revokedAt === undefined,
    )
    .sort((a, b) => b.importedAt - a.importedAt)
}

export async function listBundles(): Promise<PqPublicBundleRecord[]> {
  try {
    return await usableBundles()
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function getBundle(
  recordId: string,
): Promise<PqPublicBundleRecord | undefined> {
  try {
    const value = await (await getDb()).get(STORE_PQ_PUBLIC_BUNDLES, recordId)
    return value === undefined ? undefined : checkedBundle(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findBundleBySigningKeyId(
  signingKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  try {
    return (await usableBundles()).find((record) => record.signing.keyId === signingKeyId)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findBundleByKemKeyId(
  kemKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  try {
    return (await usableBundles()).find((record) => record.kem.keyId === kemKeyId)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function saveBundle(record: PqPublicBundleRecord): Promise<void> {
  const checked = checkedBundle(record)
  // Import never confers trust. Only confirmBundleFingerprint may perform this
  // transition after the out-of-band comparison UI has completed.
  if (
    checked.trust !== "unverified" ||
    checked.trustConfirmedAt !== undefined ||
    checked.revokedAt !== undefined ||
    checked.lastUsedAt !== undefined
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  try {
    await (await getDb()).add(STORE_PQ_PUBLIC_BUNDLES, checked)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function confirmBundleFingerprint(
  recordId: string,
  confirmedAt: number,
): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_PUBLIC_BUNDLES, "readwrite")
    const existing = await tx.store.get(recordId)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(
      checkedBundle({
        ...existing,
        trust: "fingerprint-confirmed",
        trustConfirmedAt: confirmedAt,
      }),
    )
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function revokeBundle(recordId: string, revokedAt: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_PUBLIC_BUNDLES, "readwrite")
    const existing = await tx.store.get(recordId)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(checkedBundle({ ...existing, revokedAt }))
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function deleteBundle(recordId: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE_PQ_PUBLIC_BUNDLES, recordId)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function markBundleUsed(recordId: string, usedAt: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_PUBLIC_BUNDLES, "readwrite")
    const existing = await tx.store.get(recordId)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(checkedBundle({ ...existing, lastUsedAt: usedAt }))
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
