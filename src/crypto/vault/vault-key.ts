// ローカル Vault 鍵(spec2 §9、WP-11)。非抽出 AES-256-GCM CryptoKey を
// appMetadata ストア(key: "vault-key")に保存する。
//
// 競合制約(plan2.1 §C8):
//   - 作成は cross-tab lock(navigator.locks、fallback あり)+ 単一 readwrite
//     transaction 内の「存在確認 → add」(put で上書きしない)
//   - 競合に敗けた側は生成した鍵を破棄し、保存済みの鍵を再読込する
//   - 上書きは回復不能な identity を作るため絶対に行わない
import type { EncryptedSecret } from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { getDb, STORE_APP_METADATA, type KeyValueRow } from "@/storage/database"

export const VAULT_KEY_METADATA_KEY = "vault-key"

const VAULT_LOCK_NAME = "qrypt-vault-key"

let vaultKeyPromise: Promise<CryptoKey> | undefined

function isVaultKey(value: unknown): value is CryptoKey {
  if (typeof value !== "object" || value === null) return false
  const key = value as Partial<CryptoKey>
  const algorithm = key.algorithm as Partial<AesKeyAlgorithm> | undefined
  return (
    key.type === "secret" &&
    key.extractable === false &&
    algorithm?.name === "AES-GCM" &&
    algorithm.length === 256 &&
    Array.isArray(key.usages) &&
    key.usages.includes("encrypt") &&
    key.usages.includes("decrypt")
  )
}

async function generateVaultKey(): Promise<CryptoKey> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
  if (!isVaultKey(key)) throw new AppError("STORAGE_FAILED")
  return key
}

async function createOrReadVaultKey(): Promise<CryptoKey> {
  const database = await getDb()
  const cachedRow = await database.get(STORE_APP_METADATA, VAULT_KEY_METADATA_KEY)
  if (cachedRow !== undefined) {
    if (!isVaultKey(cachedRow.value)) throw new AppError("STORAGE_FAILED")
    return cachedRow.value
  }

  // 鍵生成は transaction の外で行う。WebCrypto 待機中に IDB transaction が
  // auto-commit されるのを避け、存在確認→add 自体は一つの readwrite 内に置く。
  const generated = await generateVaultKey()
  const transaction = database.transaction(STORE_APP_METADATA, "readwrite")
  const existing = await transaction.store.get(VAULT_KEY_METADATA_KEY)
  if (existing !== undefined) {
    await transaction.done
    if (!isVaultKey(existing.value)) throw new AppError("STORAGE_FAILED")
    // 競合に敗れた生成鍵は保存せず、ここで最後の参照を捨てる。
    return existing.value
  }
  const row: KeyValueRow = { key: VAULT_KEY_METADATA_KEY, value: generated }
  await transaction.store.add(row)
  await transaction.done
  return generated
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

// WipeCoordinator(plan2.1 §B3)用: メモリー上の Vault 鍵参照・promise を破棄する
export function dropVaultKeyCache(): void {
  vaultKeyPromise = undefined
}

// 暗号シュレッディング参照用の再輸出(vault 配下の EncryptedSecret 型)
export type { EncryptedSecret }
