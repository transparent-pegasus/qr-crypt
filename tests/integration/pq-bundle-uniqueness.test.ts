import { afterEach, describe, expect, it } from "vitest"
import { buildPublicBundle, createIdentity } from "@/crypto/pq/identity"
import { createPqCryptoClient, type PqCryptoClient } from "@/crypto/pq/worker-client"
import { generateKeyId } from "@/crypto/random"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import type { PostQuantumIdentity, PqPublicBundleRecord } from "@/schemas/domain"
import { closeDb, deleteEntireDatabase } from "@/storage/database"
import {
  confirmBundleFingerprint,
  findBundleByKemKeyId,
  findBundleBySigningKeyId,
  listBundles,
  revokeBundle,
  saveBundle,
} from "@/storage/pq-bundle-repository"

const NOW = 1_700_300_000_000
const clients: PqCryptoClient[] = []

function publicRecord(
  identity: PostQuantumIdentity,
  importedAt: number,
): PqPublicBundleRecord {
  const bundle = buildPublicBundle(identity)
  return {
    recordId: generateKeyId(),
    identityId: bundle.identityId,
    name: identity.name,
    kem: {
      ...bundle.kem,
      fingerprint: identity.kem.fingerprint,
    },
    signing: {
      ...bundle.signing,
      fingerprint: identity.signing.fingerprint,
    },
    identityFingerprint: identity.identityFingerprint,
    trust: "unverified",
    bundleCreatedAt: bundle.createdAt,
    importedAt,
  }
}

async function makeRecord(name: string, now: number): Promise<PqPublicBundleRecord> {
  const client = createPqCryptoClient()
  clients.push(client)
  const vaultKey = await getOrCreateVaultKey()
  const identity = await createIdentity({
    client,
    vaultKey,
    name,
    profile: "maximum",
    now,
  })
  return publicRecord(identity, now + 1)
}

async function saveError(record: PqPublicBundleRecord): Promise<unknown> {
  try {
    await saveBundle(record)
    return undefined
  } catch (error) {
    return error
  }
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  dropVaultKeyCache()
  closeDb()
  await deleteEntireDatabase()
})

describe("PQ public bundle key uniqueness", () => {
  it("refuses a different signing key that reuses a stored signing key ID", async () => {
    const stored = await makeRecord("stored signing key", NOW)
    const candidate = await makeRecord("shadow signing key", NOW + 10)
    const shadow: PqPublicBundleRecord = {
      ...candidate,
      signing: {
        ...candidate.signing,
        keyId: stored.signing.keyId,
      },
    }
    expect(shadow.signing.publicKey).not.toEqual(stored.signing.publicKey)
    await saveBundle(stored)

    const error = await saveError(shadow)

    expect(await listBundles()).toHaveLength(1)
    expect(error).toMatchObject({ code: "KEY_ID_CONFLICT" })
  }, 30_000)

  it("refuses a byte-identical re-import under a fresh record ID", async () => {
    const stored = await makeRecord("duplicate key", NOW)
    const duplicate: PqPublicBundleRecord = {
      ...stored,
      recordId: generateKeyId(),
    }
    await saveBundle(stored)

    const error = await saveError(duplicate)

    expect(await listBundles()).toHaveLength(1)
    expect(error).toMatchObject({ code: "DUPLICATE_KEY" })
  }, 30_000)

  it("refuses a partial collision on only the KEM key ID", async () => {
    const stored = await makeRecord("stored KEM key", NOW)
    const candidate = await makeRecord("partial KEM shadow", NOW + 10)
    const shadow: PqPublicBundleRecord = {
      ...candidate,
      kem: {
        ...candidate.kem,
        keyId: stored.kem.keyId,
      },
    }
    expect(shadow.signing.keyId).not.toBe(stored.signing.keyId)
    await saveBundle(stored)

    const error = await saveError(shadow)

    expect(await listBundles()).toHaveLength(1)
    expect(error).toMatchObject({ code: "KEY_ID_CONFLICT" })
  }, 30_000)

  it("keeps a revoked record's signing key ID reserved", async () => {
    const stored = await makeRecord("revoked signing key", NOW)
    const candidate = await makeRecord("revoked-key shadow", NOW + 10)
    const shadow: PqPublicBundleRecord = {
      ...candidate,
      signing: {
        ...candidate.signing,
        keyId: stored.signing.keyId,
      },
    }
    await saveBundle(stored)
    await revokeBundle(stored.recordId, NOW + 2)

    const error = await saveError(shadow)

    expect(error).toMatchObject({ code: "KEY_ID_CONFLICT" })
  }, 30_000)

  it("keeps a confirmed record authoritative after rejecting a shadow import", async () => {
    const stored = await makeRecord("confirmed signing key", NOW)
    const candidate = await makeRecord("confirmed-key shadow", NOW + 10)
    const shadow: PqPublicBundleRecord = {
      ...candidate,
      signing: {
        ...candidate.signing,
        keyId: stored.signing.keyId,
      },
    }
    await saveBundle(stored)
    await confirmBundleFingerprint(stored.recordId, NOW + 2)

    const error = await saveError(shadow)

    expect(await findBundleBySigningKeyId(stored.signing.keyId)).toMatchObject({
      recordId: stored.recordId,
      trust: "fingerprint-confirmed",
    })
    expect(error).toMatchObject({ code: "KEY_ID_CONFLICT" })
  }, 30_000)

  it("does not resolve a revoked record by either key ID", async () => {
    const stored = await makeRecord("revoked bundle", NOW)
    await saveBundle(stored)
    await revokeBundle(stored.recordId, NOW + 2)

    await expect(
      findBundleBySigningKeyId(stored.signing.keyId),
    ).resolves.toBeUndefined()
    await expect(findBundleByKemKeyId(stored.kem.keyId)).resolves.toBeUndefined()
  }, 30_000)
})
