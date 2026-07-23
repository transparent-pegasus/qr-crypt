import { afterEach, describe, expect, it, vi } from "vitest"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { buildPublicBundle, createIdentity, rotateIdentity } from "@/crypto/pq/identity"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import { createPqCryptoClient, type PqCryptoClient } from "@/crypto/pq/worker-client"
import {
  encodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2,
} from "@/crypto/pq/canonical-cbor"
import { generateKeyId } from "@/crypto/random"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { utf8ToBytes } from "@/lib/bytes"
import { buildV2Payload } from "@/qr/payload-v2"
import { decodePayload } from "@/qr/payload"
import type { PostQuantumIdentity, PqPublicBundleRecord } from "@/schemas/domain"
import {
  closeDb,
  deleteEntireDatabase,
  getDb,
  STORE_PQ_IDENTITIES,
} from "@/storage/database"
import {
  confirmBundleFingerprint,
  findBundleByKemKeyId,
  findBundleBySigningKeyId,
  getBundle,
  listBundles,
  revokeBundle,
  saveBundle,
} from "@/storage/pq-bundle-repository"
import {
  findIdentityByKemKeyId,
  findIdentityBySigningKeyId,
  getIdentity,
  revokeIdentity,
  saveIdentity,
  saveRotation,
} from "@/storage/pq-identity-repository"

const NOW = 1_700_200_000_000
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

afterEach(async () => {
  for (const client of clients.splice(0)) client.dispose()
  dropVaultKeyCache()
  closeDb()
  await deleteEntireDatabase()
})

describe("PQ envelope and storage integration", () => {
  it("generates, imports, encrypts, decrypts, rotates old KEM keys, and blocks revoked selections", async () => {
    const client = createPqCryptoClient()
    clients.push(client)
    const vaultKey = await getOrCreateVaultKey()
    const randomCallSizes: number[] = []
    const originalGetRandomValues = globalThis.crypto.getRandomValues.bind(
      globalThis.crypto,
    )
    const randomSpy = vi.spyOn(globalThis.crypto, "getRandomValues")
    randomSpy.mockImplementation(((array: Uint8Array<ArrayBuffer>) => {
      randomCallSizes.push(array.byteLength)
      return originalGetRandomValues(array)
    }) as typeof globalThis.crypto.getRandomValues)
    let recipient: PostQuantumIdentity
    try {
      recipient = await createIdentity({
        client,
        vaultKey,
        name: "受信者",
        profile: "maximum",
        now: NOW,
      })
    } finally {
      randomSpy.mockRestore()
    }
    expect(randomCallSizes.filter((size) => size === 64)).toHaveLength(1)
    expect(randomCallSizes.filter((size) => size === 32)).toHaveLength(1)
    const sender = await createIdentity({
      client,
      vaultKey,
      name: "送信者",
      profile: "maximum",
      now: NOW + 1,
    })
    expect(
      new Set([
        recipient.id,
        recipient.kem.keyId,
        recipient.signing.keyId,
        sender.id,
        sender.kem.keyId,
        sender.signing.keyId,
      ]).size,
    ).toBe(6)
    await saveIdentity(recipient)
    await saveIdentity(sender)

    const recipientRecord = publicRecord(recipient, NOW + 2)
    const senderRecord = publicRecord(sender, NOW + 2)
    await saveBundle(recipientRecord)
    await saveBundle(senderRecord)
    await expect(
      saveBundle({
        ...senderRecord,
        recordId: generateKeyId(),
        trust: "fingerprint-confirmed",
        trustConfirmedAt: NOW + 3,
      }),
    ).rejects.toMatchObject({ code: "STORAGE_FAILED" })
    await confirmBundleFingerprint(senderRecord.recordId, NOW + 3)
    expect(await getBundle(senderRecord.recordId)).toMatchObject({
      trust: "fingerprint-confirmed",
      trustConfirmedAt: NOW + 3,
    })

    const selectedRecipient = await findBundleByKemKeyId(recipient.kem.keyId)
    expect(selectedRecipient?.recordId).toBe(recipientRecord.recordId)
    const plaintext = utf8ToBytes("PQ integration message")
    const envelope = await encryptPq({
      client,
      recipient: selectedRecipient!,
      plaintext,
      sign: { identity: sender, vaultKey },
      now: NOW + 4,
    })
    const decodedBareMessage = decodePayload(
      buildV2Payload("pq-message", encodeMlKemEnvelopeV2(envelope)),
    )
    expect(decodedBareMessage.kind).toBe("pq-message")
    const decodedBundle = decodePayload(
      buildV2Payload(
        "pq-public-identity",
        encodePublicIdentityBundleV2(buildPublicBundle(recipient)),
      ),
    )
    expect(decodedBundle.kind).toBe("pq-public-identity")

    const decrypted = await decryptPqMessage({
      client,
      envelope,
      recipient,
      vaultKey,
      resolveSigningKey: async (keyId) => {
        const record = await findBundleBySigningKeyId(keyId)
        return record === undefined
          ? undefined
          : {
              algorithm: record.signing.algorithm,
              publicKey: record.signing.publicKey,
              revoked: record.revokedAt !== undefined,
            }
      },
    })
    expect(decrypted).toMatchObject({
      kind: "signed-valid",
      senderSigningKeyId: sender.signing.keyId,
    })
    if (decrypted.kind !== "signed-valid") throw new Error("signed result expected")
    expect(decrypted.plaintext).toEqual(plaintext)

    const rawIdentities = await (await getDb()).getAll(STORE_PQ_IDENTITIES)
    expect(rawIdentities).toHaveLength(2)
    for (const identity of rawIdentities) {
      expect(identity.kem.encryptedSeed.iv).toHaveLength(12)
      expect(identity.kem.encryptedSeed.ciphertext).toHaveLength(80)
      expect(identity.signing.encryptedSeed.iv).toHaveLength(12)
      expect(identity.signing.encryptedSeed.ciphertext).toHaveLength(48)
      const forbidden = new Set([
        "seed",
        "secretKey",
        "privateKey",
        "sharedSecret",
        "expandedSecretKey",
      ])
      const inspectKeys = (value: unknown): void => {
        if (value instanceof Uint8Array || typeof value !== "object" || value === null) {
          return
        }
        for (const [key, nested] of Object.entries(value)) {
          expect(forbidden.has(key)).toBe(false)
          inspectKeys(nested)
        }
      }
      inspectKeys(identity)
    }

    const rotation = await rotateIdentity({
      client,
      vaultKey,
      current: recipient,
      now: NOW + 5,
    })
    await saveRotation(rotation)
    const oldRecipient = await findIdentityByKemKeyId(recipient.kem.keyId)
    expect(oldRecipient).toMatchObject({ id: recipient.id, status: "rotated" })
    expect(await findIdentityBySigningKeyId(recipient.signing.keyId)).toBeUndefined()
    expect(await findIdentityBySigningKeyId(rotation.next.signing.keyId)).toMatchObject({
      id: rotation.next.id,
      status: "active",
    })
    const oldKeyResult = await decryptPqMessage({
      client,
      envelope,
      recipient: oldRecipient!,
      vaultKey,
      resolveSigningKey: async () => ({
        algorithm: sender.signing.algorithm,
        publicKey: sender.signing.publicKey,
        revoked: false,
      }),
    })
    expect(oldKeyResult.kind).toBe("signed-valid")

    await revokeIdentity(sender.id, NOW + 6)
    const revokedSender = await getIdentity(sender.id)
    expect(revokedSender?.status).toBe("revoked")
    expect(await findIdentityBySigningKeyId(sender.signing.keyId)).toBeUndefined()
    expect(await findIdentityByKemKeyId(sender.kem.keyId)).toMatchObject({
      id: sender.id,
      status: "revoked",
    })
    await expect(
      encryptPq({
        client,
        recipient: recipientRecord,
        plaintext,
        sign: { identity: revokedSender!, vaultKey },
        now: NOW + 7,
      }),
    ).rejects.toMatchObject({ code: "ENCRYPTION_FAILED" })

    await revokeBundle(recipientRecord.recordId, NOW + 8)
    expect(await findBundleByKemKeyId(recipient.kem.keyId)).toBeUndefined()
    expect((await listBundles()).map((record) => record.recordId)).not.toContain(
      recipientRecord.recordId,
    )
    const revokedRecipient = await getBundle(recipientRecord.recordId)
    await expect(
      encryptPq({
        client,
        recipient: revokedRecipient!,
        plaintext,
        now: NOW + 9,
      }),
    ).rejects.toMatchObject({ code: "KEY_NOT_FOUND" })
  }, 30_000)
})
