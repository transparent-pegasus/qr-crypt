// CRUD for the pqPublicBundles store.
// keyPath: recordId / indexes: by-identityId (non-unique), signing.keyId and
// kem.keyId (unique).
//
// Rules (frozen):
//   - Encryption recipient selection uses only records without revokedAt.
//   - Resolve keys by exact unique-index lookup; treat revoked keys as unknown.
//   - Refuse imports colliding with any stored signing.keyId or kem.keyId.
//   - Only the confirmation action on the fingerprint-comparison screen may transition
//     trust ("unverified" | "fingerprint-confirmed"); imports are always unverified.
import type { PqPublicBundleRecord } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { bytesEqual } from "@/lib/bytes"
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

function sameKeyMaterial(
  existing: PqPublicBundleRecord,
  incoming: PqPublicBundleRecord,
): boolean {
  return (
    existing.kem.algorithm === incoming.kem.algorithm &&
    existing.signing.algorithm === incoming.signing.algorithm &&
    bytesEqual(existing.kem.publicKey, incoming.kem.publicKey) &&
    bytesEqual(existing.signing.publicKey, incoming.signing.publicKey)
  )
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

async function resolveByIndex(
  index: "by-signingKeyId" | "by-kemKeyId",
  keyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  const value = await (await getDb()).getFromIndex(
    STORE_PQ_PUBLIC_BUNDLES,
    index,
    keyId,
  )
  const record = value === undefined ? undefined : safeBundle(value)
  // Revoked records stay unresolvable: treat them as unknown, never as a fallback.
  return record === undefined || record.revokedAt !== undefined ? undefined : record
}

export async function findBundleBySigningKeyId(
  signingKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  try {
    return await resolveByIndex("by-signingKeyId", signingKeyId)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findBundleByKemKeyId(
  kemKeyId: string,
): Promise<PqPublicBundleRecord | undefined> {
  try {
    return await resolveByIndex("by-kemKeyId", kemKeyId)
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
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_PUBLIC_BUNDLES, "readwrite")
    // Key ids are 16 random bytes chosen by the sending device, not derived from the
    // public key, so an attacker can assert any id. Uniqueness is enforced here over
    // every record including revoked ones: skipping revoked rows would let a revoked
    // key id be re-imported and become the resolution target again.
    const signing = safeBundle(
      await tx.store.index("by-signingKeyId").get(checked.signing.keyId),
    )
    const kem = safeBundle(
      await tx.store.index("by-kemKeyId").get(checked.kem.keyId),
    )
    if (signing !== undefined || kem !== undefined) {
      const existing =
        signing !== undefined && kem !== undefined && signing.recordId === kem.recordId
          ? signing
          : undefined
      const reservedByRevokedBundle =
        signing?.revokedAt !== undefined || kem?.revokedAt !== undefined
      await tx.done
      throw new AppError(
        !reservedByRevokedBundle &&
          existing !== undefined &&
          sameKeyMaterial(existing, checked)
          ? "DUPLICATE_KEY"
          : "KEY_ID_CONFLICT",
      )
    }
    await tx.store.add(checked)
    await tx.done
  } catch (error) {
    // Fail-closed backstop for a lost import race: deliberately report the
    // conflict code even when the racing import carried the same key material.
    if (error instanceof DOMException && error.name === "ConstraintError") {
      throw new AppError("KEY_ID_CONFLICT")
    }
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
