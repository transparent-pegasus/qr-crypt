import { afterEach, describe, expect, it } from "vitest"
import { AppError } from "@/crypto/errors"
import { decryptSecret } from "@/crypto/vault/decrypt-secret"
import { encryptSecret } from "@/crypto/vault/encrypt-secret"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { closeDb, deleteEntireDatabase } from "@/storage/database"
import type { VaultAadFieldsV2 } from "@/crypto/pq/wire-bytes"

const ID_A = "AAECAwQFBgcICQoLDA0ODw"
const ID_B = "EAESExQVFhcYGRobHB0eHw"

const KEM_AAD: VaultAadFieldsV2 = {
  identityId: ID_A,
  role: "ml-kem-seed",
  algorithm: "ML-KEM-768",
  keyId: ID_B,
  publicKeySha256: new Uint8Array(32).fill(0x11),
}

afterEach(async () => {
  dropVaultKeyCache()
  closeDb()
  await deleteEntireDatabase()
})

describe("vault key", () => {
  it("creates once under concurrent callers and is non-extractable", async () => {
    const keys = await Promise.all(
      Array.from({ length: 12 }, () => getOrCreateVaultKey()),
    )
    expect(keys.every((key) => key === keys[0])).toBe(true)
    expect(keys[0]?.extractable).toBe(false)
    expect(keys[0]?.algorithm).toMatchObject({ name: "AES-GCM", length: 256 })
    await expect(crypto.subtle.exportKey("raw", keys[0]!)).rejects.toBeDefined()
  })

  it("reuses the persisted key after dropping the memory cache", async () => {
    const original = await getOrCreateVaultKey()
    const seed = new Uint8Array(64).fill(0x21)
    const encrypted = await encryptSecret({
      vaultKey: original,
      plaintextSecret: seed,
      aad: KEM_AAD,
    })
    dropVaultKeyCache()
    closeDb()
    const reopened = await getOrCreateVaultKey()
    await expect(
      decryptSecret({ vaultKey: reopened, secret: encrypted, aad: KEM_AAD }),
    ).resolves.toEqual(seed)
  })
})

describe("vault secret AAD", () => {
  it("round-trips KEM and DSA seeds", async () => {
    const vaultKey = await getOrCreateVaultKey()
    const kemSeed = new Uint8Array(64).fill(0x31)
    const dsaSeed = new Uint8Array(32).fill(0x32)
    const dsaAad: VaultAadFieldsV2 = {
      identityId: ID_A,
      role: "ml-dsa-seed",
      algorithm: "ML-DSA-65",
      keyId: ID_B,
      publicKeySha256: new Uint8Array(32).fill(0x22),
    }
    const kemEncrypted = await encryptSecret({
      vaultKey,
      plaintextSecret: kemSeed,
      aad: KEM_AAD,
    })
    const dsaEncrypted = await encryptSecret({
      vaultKey,
      plaintextSecret: dsaSeed,
      aad: dsaAad,
    })
    expect(kemEncrypted.iv).toHaveLength(12)
    expect(kemEncrypted.ciphertext).toHaveLength(80)
    expect(dsaEncrypted.ciphertext).toHaveLength(48)
    await expect(
      decryptSecret({ vaultKey, secret: kemEncrypted, aad: KEM_AAD }),
    ).resolves.toEqual(kemSeed)
    await expect(
      decryptSecret({ vaultKey, secret: dsaEncrypted, aad: dsaAad }),
    ).resolves.toEqual(dsaSeed)
  })

  it("rejects a single-usage AES key at both vault boundaries (isVaultKey requires both)", async () => {
    const rawKey = new Uint8Array(32).fill(0x61)
    const fullUsage = await crypto.subtle.importKey("raw", rawKey, "AES-GCM", false, [
      "encrypt",
      "decrypt",
    ])
    const encryptOnly = await crypto.subtle.importKey(
      "raw",
      rawKey,
      "AES-GCM",
      false,
      ["encrypt"],
    )
    const decryptOnly = await crypto.subtle.importKey(
      "raw",
      rawKey,
      "AES-GCM",
      false,
      ["decrypt"],
    )
    const plaintextSecret = new Uint8Array(64).fill(0x31)
    const encryptedSecret = await encryptSecret({
      vaultKey: fullUsage,
      plaintextSecret,
      aad: KEM_AAD,
    })

    await expect.soft(
      encryptSecret({
        vaultKey: encryptOnly,
        plaintextSecret,
        aad: KEM_AAD,
      }),
    ).rejects.toMatchObject({ code: "ENCRYPTION_FAILED" })
    await expect.soft(
      decryptSecret({
        vaultKey: decryptOnly,
        secret: encryptedSecret,
        aad: KEM_AAD,
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })

  it.each([
    ["identity", { ...KEM_AAD, identityId: ID_B }],
    ["key", { ...KEM_AAD, keyId: ID_A }],
    ["public-key hash", { ...KEM_AAD, publicKeySha256: new Uint8Array(32).fill(0x12) }],
  ] as const)("fails closed when %s AAD is swapped", async (_label, swappedAad) => {
    const vaultKey = await getOrCreateVaultKey()
    const encrypted = await encryptSecret({
      vaultKey,
      plaintextSecret: new Uint8Array(64).fill(0x41),
      aad: KEM_AAD,
    })
    await expect(
      decryptSecret({ vaultKey, secret: encrypted, aad: swappedAad }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" } satisfies Partial<AppError>)
  })

  it("fails closed for a different role and for ciphertext tampering", async () => {
    const vaultKey = await getOrCreateVaultKey()
    const encrypted = await encryptSecret({
      vaultKey,
      plaintextSecret: new Uint8Array(64).fill(0x51),
      aad: KEM_AAD,
    })
    const roleSwapped: VaultAadFieldsV2 = {
      ...KEM_AAD,
      role: "ml-dsa-seed",
      algorithm: "ML-DSA-65",
    }
    await expect(
      decryptSecret({ vaultKey, secret: encrypted, aad: roleSwapped }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })

    const tampered = {
      iv: Uint8Array.from(encrypted.iv),
      ciphertext: Uint8Array.from(encrypted.ciphertext),
    }
    tampered.ciphertext[0] = tampered.ciphertext[0]! ^ 1
    await expect(
      decryptSecret({ vaultKey, secret: tampered, aad: KEM_AAD }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })
})
