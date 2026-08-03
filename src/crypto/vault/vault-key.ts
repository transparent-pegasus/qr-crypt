// Local Vault key. Store a non-extractable AES-256-GCM CryptoKey
// in the appMetadata store (key: "vault-key").
//
// Concurrency constraints:
//   - Creation uses a cross-tab lock (navigator.locks, with a fallback) plus
//     "check for existence → add" in one readwrite transaction (never overwrite with put).
//   - The side that loses the race discards its generated key and reloads the stored key.
//   - Never overwrite the key, because doing so creates unrecoverable identities.
import { AppError, toAppError } from "@/crypto/errors"
import { isVaultKey } from "@/crypto/vault/is-vault-key"
import {
  getDb,
  STORE_APP_METADATA,
  withSensitiveWriteLock,
  type KeyValueRow,
} from "@/storage/database"

export const VAULT_KEY_METADATA_KEY = "vault-key"

const VAULT_LOCK_NAME = "qr-crypt-vault-key"

let vaultKeyPromise: Promise<CryptoKey> | undefined

async function generateVaultKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
  if (!isVaultKey(key)) throw new AppError("STORAGE_FAILED")
  return key
}

// Nesting is vault (exclusive, outer) → sensitive-write (shared, inner): two
// different lock names. Two paths take the sensitive-write lock exclusively —
// boot's proof (withSensitiveWritesExcluded, briefly, with a 3s abort) and the
// relay lease (acquireRelayLease, for a session) — and neither holds or
// requests another lock while it does, so no cycle exists. Do not hoist the
// shared request outside withCrossTabLock — the wrapper is already on this
// stack and Web Locks has no reentrancy.
function createOrReadVaultKey(): Promise<CryptoKey> {
  return withSensitiveWriteLock(async () => {
    const database = await getDb()
    const cachedRow = await database.get(STORE_APP_METADATA, VAULT_KEY_METADATA_KEY)
    if (cachedRow !== undefined) {
      if (!isVaultKey(cachedRow.value)) throw new AppError("STORAGE_FAILED")
      return cachedRow.value
    }

    // Generate the key outside the transaction. This avoids an IDB transaction
    // auto-committing while WebCrypto is pending, while the existence check and add
    // still remain within one readwrite transaction.
    const generated = await generateVaultKey()
    const transaction = database.transaction(STORE_APP_METADATA, "readwrite")
    const existing = await transaction.store.get(VAULT_KEY_METADATA_KEY)
    if (existing !== undefined) {
      await transaction.done
      if (!isVaultKey(existing.value)) throw new AppError("STORAGE_FAILED")
      // Do not store the generated key that lost the race; drop its final reference here.
      return existing.value
    }
    const row: KeyValueRow = { key: VAULT_KEY_METADATA_KEY, value: generated }
    await transaction.store.add(row)
    await transaction.done
    return generated
  })
}

async function withCrossTabLock<T>(action: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === "undefined" ? undefined : navigator.locks
  if (locks === undefined) return action()
  return locks.request(VAULT_LOCK_NAME, { mode: "exclusive" }, action)
}

export function getOrCreateVaultKey(): Promise<CryptoKey> {
  if (vaultKeyPromise !== undefined) return vaultKeyPromise
  const pending = withCrossTabLock(createOrReadVaultKey).catch((error: unknown) => {
    if (vaultKeyPromise === pending) vaultKeyPromise = undefined
    throw toAppError(error, "STORAGE_FAILED")
  })
  vaultKeyPromise = pending
  return pending
}

// For WipeCoordinator: discard in-memory Vault key references and promises.
export function dropVaultKeyCache(): void {
  vaultKeyPromise = undefined
}
