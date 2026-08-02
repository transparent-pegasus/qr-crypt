// CRUD for the pqIdentities store.
// keyPath: id / indexes: by-createdAt, by-kemKeyId, by-signingKeyId.
//
// Frozen selection rules:
//   - Decryption: search every non-destroyed identity, including rotated, by kem.keyId.
//   - Signing: only signing material with status="active"; revoked/rotated identities
//     cannot sign.
//   - Never persist expanded secret keys; persist only the seed's EncryptedSecret.
import type { PostQuantumIdentity } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { keyNameSchema, validatePostQuantumIdentity } from "@/schemas/key-schema"
import { getDb, STORE_PQ_IDENTITIES, withSensitiveWriteLock } from "@/storage/database"

function checkedIdentity(value: unknown): PostQuantumIdentity {
  try {
    return validatePostQuantumIdentity(value)
  } catch {
    throw new AppError("STORAGE_FAILED")
  }
}

function safeIdentity(value: unknown): PostQuantumIdentity | undefined {
  try {
    return validatePostQuantumIdentity(value)
  } catch {
    return undefined
  }
}

export async function listIdentities(): Promise<PostQuantumIdentity[]> {
  try {
    return (await (await getDb()).getAll(STORE_PQ_IDENTITIES))
      .map(safeIdentity)
      .filter((identity): identity is PostQuantumIdentity => identity !== undefined)
      .sort((a, b) => b.createdAt - a.createdAt)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function getIdentity(id: string): Promise<PostQuantumIdentity | undefined> {
  try {
    const value = await (await getDb()).get(STORE_PQ_IDENTITIES, id)
    return value === undefined ? undefined : checkedIdentity(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findIdentityByKemKeyId(
  kemKeyId: string,
): Promise<PostQuantumIdentity | undefined> {
  try {
    const value = await (
      await getDb()
    ).getFromIndex(STORE_PQ_IDENTITIES, "by-kemKeyId", kemKeyId)
    // Rotated and revoked rows remain valid decrypt recipients. Physical deletion is
    // the only state that removes a KEM key from this lookup.
    return value === undefined ? undefined : checkedIdentity(value)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function findIdentityBySigningKeyId(
  signingKeyId: string,
): Promise<PostQuantumIdentity | undefined> {
  try {
    const value = await (
      await getDb()
    ).getFromIndex(STORE_PQ_IDENTITIES, "by-signingKeyId", signingKeyId)
    if (value === undefined) return undefined
    const identity = checkedIdentity(value)
    return identity.status === "active" ? identity : undefined
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export function saveIdentity(identity: PostQuantumIdentity): Promise<void> {
  return withSensitiveWriteLock(async () => {
    const checked = checkedIdentity(identity)
    if (checked.status !== "active") throw new AppError("STORAGE_FAILED")
    try {
      await (await getDb()).add(STORE_PQ_IDENTITIES, checked)
    } catch (error) {
      throw toAppError(error, "STORAGE_FAILED")
    }
  })
}

// Rotation: store both rows returned by rotateIdentity in one transaction.
export function saveRotation(args: {
  next: PostQuantumIdentity
  previous: PostQuantumIdentity
}): Promise<void> {
  return withSensitiveWriteLock(async () => {
    const next = checkedIdentity(args.next)
    const previous = checkedIdentity(args.previous)
    if (
      next.status !== "active" ||
      previous.status !== "rotated" ||
      next.rotatedFromId !== previous.id ||
      previous.rotatedAt === undefined ||
      next.createdAt !== previous.rotatedAt
    ) {
      throw new AppError("STORAGE_FAILED")
    }
    try {
      const database = await getDb()
      const tx = database.transaction(STORE_PQ_IDENTITIES, "readwrite")
      const persistedValue = await tx.store.get(previous.id)
      if (persistedValue === undefined) throw new AppError("STORAGE_FAILED")
      // Validated because it is about to be written back, not merely compared.
      const persisted = checkedIdentity(persistedValue)
      if (
        persisted.status !== "active" ||
        persisted.kem.keyId !== previous.kem.keyId ||
        persisted.signing.keyId !== previous.signing.keyId ||
        persisted.identityFingerprint !== previous.identityFingerprint
      ) {
        throw new AppError("STORAGE_FAILED")
      }
      // The persisted row wins, exactly as for symmetric rotation: the caller's
      // snapshot predates any rename or use this generation recorded while the
      // Worker was generating. identityFingerprint is taken over a name-free
      // tuple, so the new head can carry the current name without invalidating it.
      await tx.store.put(
        checkedIdentity({
          ...persisted,
          status: "rotated",
          rotatedAt: previous.rotatedAt,
        }),
      )
      await tx.store.add(checkedIdentity({ ...next, name: persisted.name }))
      await tx.done
    } catch (error) {
      throw toAppError(error, "STORAGE_FAILED")
    }
  })
}

export async function revokeIdentity(id: string, revokedAt: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_IDENTITIES, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(checkedIdentity({ ...existing, status: "revoked", revokedAt }))
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function deleteIdentity(id: string): Promise<void> {
  try {
    await (await getDb()).delete(STORE_PQ_IDENTITIES, id)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// Forward-secrecy action: drop the key material of generations that were
// superseded or revoked. Rotation deliberately keeps them decryptable so that
// messages already in flight to the old KEM key can still be opened, which means
// the old seeds outlive their usefulness unless something removes them.
//
// Whole-request check inside one transaction: a stale UI id must never take an
// active identity with it, and a partial delete would leave the caller unable to
// say what survived. This is a best-effort logical delete — LevelDB is
// append-oriented and SSDs wear-level — so it closes a retained decryption route
// rather than erasing bytes.
export async function deleteSupersededIdentities(
  ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_IDENTITIES, "readwrite")
    const present: string[] = []
    for (const id of new Set(ids)) {
      const existing = await tx.store.get(id)
      if (existing === undefined) continue
      const identity = checkedIdentity(existing)
      if (identity.status === "active") throw new AppError("STORAGE_FAILED")
      present.push(identity.id)
    }
    for (const id of present) await tx.store.delete(id)
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function clearAllIdentities(): Promise<void> {
  try {
    await (await getDb()).clear(STORE_PQ_IDENTITIES)
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

// Renaming is a head-generation operation. Superseded rows stay stored so old messages
// can still be decrypted, and their names are part of the audit trail the rotation left
// behind — a direct caller must not be able to rewrite them.
export async function renameIdentity(id: string, name: string): Promise<void> {
  try {
    const parsedName = keyNameSchema.parse(name)
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_IDENTITIES, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    const checked = checkedIdentity(existing)
    if (checked.status === "rotated") throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(checkedIdentity({ ...checked, name: parsedName }))
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}

export async function markIdentityUsed(id: string, usedAt: number): Promise<void> {
  try {
    const database = await getDb()
    const tx = database.transaction(STORE_PQ_IDENTITIES, "readwrite")
    const existing = await tx.store.get(id)
    if (existing === undefined) throw new AppError("KEY_NOT_FOUND")
    await tx.store.put(checkedIdentity({ ...existing, lastUsedAt: usedAt }))
    await tx.done
  } catch (error) {
    throw toAppError(error, "STORAGE_FAILED")
  }
}
