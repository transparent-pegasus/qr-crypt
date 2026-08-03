import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { openSymMessage, sealSymMessage } from "@/crypto/aes-gcm"
import { createSymmetricKeyRecord } from "@/crypto/key-generation"
import {
  createPqCryptoClient,
  type PqCryptoClient,
} from "@/crypto/pq/worker-client"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { toBase64Url } from "@/lib/base64url"
import { utf8ToBytes } from "@/lib/bytes"
import type {
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
} from "@/schemas/domain"
import { closeDb, deleteEntireDatabase } from "@/storage/database"

const NOW = 1_700_000_000_000
const PLAINTEXT = utf8ToBytes("fixed-salt derivation round trip")

function changedIv(iv: Uint8Array): Uint8Array {
  const changed = Uint8Array.from(iv)
  changed[0] = changed[0]! ^ 1
  return changed
}

function keyId(fill: number): string {
  return toBase64Url(new Uint8Array(16).fill(fill))
}

describe("symmetric fixed-salt derivation", () => {
  it("seals and opens without emitting hkdfSalt", async () => {
    const record = await createSymmetricKeyRecord("saltless round trip", NOW)
    const envelope = await sealSymMessage({
      record,
      plaintext: PLAINTEXT,
      now: NOW + 1,
    })

    await expect(openSymMessage({ record, envelope })).resolves.toEqual(PLAINTEXT)
    expect(Object.keys(envelope)).not.toContain("hkdfSalt")
  })

  it("uses a fresh IV for identical plaintext under the same key", async () => {
    const record = await createSymmetricKeyRecord("fresh IV", NOW)
    const first = await sealSymMessage({ record, plaintext: PLAINTEXT, now: NOW + 1 })
    const second = await sealSymMessage({
      record,
      plaintext: PLAINTEXT,
      now: NOW + 1,
    })

    expect(second.iv).not.toEqual(first.iv)
    expect(second.ciphertext).not.toEqual(first.ciphertext)
  })

  it("rejects a one-bit IV mutation", async () => {
    const record = await createSymmetricKeyRecord("IV authentication", NOW)
    const envelope = await sealSymMessage({
      record,
      plaintext: PLAINTEXT,
      now: NOW + 1,
    })

    await expect(
      openSymMessage({
        record,
        envelope: { ...envelope, iv: changedIv(envelope.iv) },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })
})

describe("post-quantum fixed-salt derivation", () => {
  let pq: PqCryptoClient
  let identity: PostQuantumIdentity
  let vaultKey: CryptoKey

  beforeAll(async () => {
    pq = createPqCryptoClient()
    vaultKey = await getOrCreateVaultKey()
    const identityId = keyId(31)
    const kemKeyId = keyId(32)
    const signingKeyId = keyId(33)
    const generated = await pq.generateIdentityKeys({
      profile: "maximum",
      vaultKey,
      identityId,
      kemKeyId,
      signingKeyId,
    })
    identity = {
      id: identityId,
      name: "saltless-test",
      profile: "maximum",
      kem: {
        algorithm: "ML-KEM-1024",
        keyId: kemKeyId,
        publicKey: generated.kem.publicKey,
        encryptedSeed: generated.kem.encryptedSeed,
        fingerprint: "test-kem",
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId: signingKeyId,
        publicKey: generated.signing.publicKey,
        encryptedSeed: generated.signing.encryptedSeed,
        fingerprint: "test-dsa",
      },
      identityFingerprint: "test-identity",
      status: "active",
      createdAt: NOW,
    }
  })

  afterAll(async () => {
    pq.dispose()
    dropVaultKeyCache()
    closeDb()
    await deleteEntireDatabase()
  })

  function encrypt(): Promise<MlKemMessageEnvelopeV2> {
    return pq.encryptPqMessage({
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: identity.kem.keyId,
      recipientKemPublicKey: identity.kem.publicKey,
      plaintext: PLAINTEXT,
      messageId: new Uint8Array(16).fill(0x42),
      createdAt: NOW + 1,
      sign: {
        senderSigningKeyId: identity.signing.keyId,
        algorithm: identity.signing.algorithm,
        vaultKey,
        identityId: identity.id,
        encryptedSeed: identity.signing.encryptedSeed,
        storedPublicKey: identity.signing.publicKey,
      },
    })
  }

  function recipient() {
    return {
      identityId: identity.id,
      kemAlgorithm: identity.kem.algorithm,
      kemKeyId: identity.kem.keyId,
      encryptedKemSeed: identity.kem.encryptedSeed,
      storedKemPublicKey: identity.kem.publicKey,
      vaultKey,
    } as const
  }

  it("seals and opens without emitting hkdfSalt", async () => {
    const envelope = await encrypt()
    const opened = await pq.openPqEnvelope({ envelope, recipient: recipient() })
    expect(opened.kind).toBe("signed")
    if (opened.kind !== "signed") throw new Error("expected signed result")

    await expect(
      pq.verifySignedMessage({
        signedMessageBytes: opened.signedMessageBytes,
        senderPublicKey: identity.signing.publicKey,
        algorithm: identity.signing.algorithm,
      }),
    ).resolves.toMatchObject({ valid: true, plaintext: PLAINTEXT })
    expect(Object.keys(envelope)).not.toContain("hkdfSalt")
  })

  it("uses a fresh IV for identical plaintext under the same key", async () => {
    const first = await encrypt()
    const second = await encrypt()

    expect(second.iv).not.toEqual(first.iv)
    expect(second.ciphertext).not.toEqual(first.ciphertext)
  })

  it("rejects a one-bit IV mutation", async () => {
    const envelope = await encrypt()

    await expect(
      pq.openPqEnvelope({
        envelope: { ...envelope, iv: changedIv(envelope.iv) },
        recipient: recipient(),
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })
})
