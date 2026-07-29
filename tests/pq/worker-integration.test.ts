import { afterEach, describe, expect, it } from "vitest"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { decodeSignedMessageV2, encodeSignedMessageV2 } from "@/crypto/pq/canonical-cbor"
import { createPqCryptoClient, type PqCryptoClient } from "@/crypto/pq/worker-client"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { closeDb, deleteEntireDatabase } from "@/storage/database"
import { toBase64Url } from "@/lib/base64url"
import type { MlKemMessageEnvelopeV2, PostQuantumIdentity } from "@/schemas/domain"

const clients = new Set<PqCryptoClient>()

function keyId(fill: number): string {
  return toBase64Url(new Uint8Array(16).fill(fill))
}

function client(): PqCryptoClient {
  const value = createPqCryptoClient()
  clients.add(value)
  return value
}

async function identity(
  pq: PqCryptoClient,
  fill: number,
  profile: "balanced" | "maximum" = "maximum",
): Promise<{ identity: PostQuantumIdentity; vaultKey: CryptoKey }> {
  const vaultKey = await getOrCreateVaultKey()
  const identityId = keyId(fill)
  const kemKeyId = keyId(fill + 1)
  const signingKeyId = keyId(fill + 2)
  const generated = await pq.generateIdentityKeys({
    profile,
    vaultKey,
    identityId,
    kemKeyId,
    signingKeyId,
  })
  const maximum = profile === "maximum"
  return {
    vaultKey,
    identity: {
      id: identityId,
      name: `identity-${fill}`,
      profile,
      kem: {
        algorithm: maximum ? "ML-KEM-1024" : "ML-KEM-768",
        keyId: kemKeyId,
        publicKey: generated.kem.publicKey,
        encryptedSeed: generated.kem.encryptedSeed,
        fingerprint: "test-kem",
      },
      signing: {
        algorithm: maximum ? "ML-DSA-87" : "ML-DSA-65",
        keyId: signingKeyId,
        publicKey: generated.signing.publicKey,
        encryptedSeed: generated.signing.encryptedSeed,
        fingerprint: "test-dsa",
      },
      identityFingerprint: "test-identity",
      status: "active",
      createdAt: 1_700_000_000_000,
    },
  }
}

function cloneEnvelope(envelope: MlKemMessageEnvelopeV2): MlKemMessageEnvelopeV2 {
  return {
    ...envelope,
    kemCiphertext: Uint8Array.from(envelope.kemCiphertext),
    hkdfSalt: Uint8Array.from(envelope.hkdfSalt),
    iv: Uint8Array.from(envelope.iv),
    ciphertext: Uint8Array.from(envelope.ciphertext),
  }
}

afterEach(async () => {
  for (const pq of clients) pq.dispose()
  clients.clear()
  dropVaultKeyCache()
  closeDb()
  await deleteEntireDatabase()
})

describe("in-process PQ Worker handler", () => {
  it("rejects balanced identity generation before cryptography", async () => {
    const pq = client()
    await expect(
      pq.generateIdentityKeys({
        profile: "balanced",
        vaultKey: await getOrCreateVaultKey(),
        identityId: keyId(1),
        kemKeyId: keyId(2),
        signingKeyId: keyId(3),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
  })

  it("generates and regenerates maximum public keys without returning seeds", async () => {
    const pq = client()
    const generated = await identity(pq, 11)
    const restored = await pq.publicKeysFromSeeds({
      vaultKey: generated.vaultKey,
      identityId: generated.identity.id,
      kem: {
        algorithm: generated.identity.kem.algorithm,
        keyId: generated.identity.kem.keyId,
        encryptedSeed: generated.identity.kem.encryptedSeed,
        storedPublicKey: generated.identity.kem.publicKey,
      },
      signing: {
        algorithm: generated.identity.signing.algorithm,
        keyId: generated.identity.signing.keyId,
        encryptedSeed: generated.identity.signing.encryptedSeed,
        storedPublicKey: generated.identity.signing.publicKey,
      },
    })
    expect(restored.kemPublicKey).toEqual(generated.identity.kem.publicKey)
    expect(restored.dsaPublicKey).toEqual(generated.identity.signing.publicKey)
    expect("seed" in restored).toBe(false)
    expect("secretKey" in restored).toBe(false)
    expect(generated.identity.kem.encryptedSeed.ciphertext).toHaveLength(80)
    expect(generated.identity.signing.encryptedSeed.ciphertext).toHaveLength(48)
  })

  it("signs with an encrypted seed and verifies only public artifacts", async () => {
    const pq = client()
    const generated = await identity(pq, 21)
    const message = new TextEncoder().encode("worker sign request")
    const signature = await pq.signWithSeed({
      algorithm: generated.identity.signing.algorithm,
      vaultKey: generated.vaultKey,
      identityId: generated.identity.id,
      keyId: generated.identity.signing.keyId,
      encryptedSeed: generated.identity.signing.encryptedSeed,
      storedPublicKey: generated.identity.signing.publicKey,
      message,
    })
    await expect(
      pq.verify({
        algorithm: generated.identity.signing.algorithm,
        publicKey: generated.identity.signing.publicKey,
        message,
        signature,
      }),
    ).resolves.toBe(true)
    message[0] = message[0]! ^ 1
    await expect(
      pq.verify({
        algorithm: generated.identity.signing.algorithm,
        publicKey: generated.identity.signing.publicKey,
        message,
        signature,
      }),
    ).resolves.toBe(false)
  })

  it("encrypts and opens an unsigned envelope", async () => {
    const pq = client()
    const generated = await identity(pq, 31)
    const plaintext = new TextEncoder().encode("unsigned worker round trip")
    const messageId = new Uint8Array(16).fill(0x41)
    const createdAt = 1_700_000_000_001
    const envelope = await pq.encryptPqMessage({
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: generated.identity.kem.keyId,
      recipientKemPublicKey: generated.identity.kem.publicKey,
      plaintext,
      messageId,
      createdAt,
    })
    const opened = await pq.openPqEnvelope({
      envelope,
      recipient: {
        identityId: generated.identity.id,
        kemAlgorithm: generated.identity.kem.algorithm,
        kemKeyId: generated.identity.kem.keyId,
        encryptedKemSeed: generated.identity.kem.encryptedSeed,
        storedKemPublicKey: generated.identity.kem.publicKey,
        vaultKey: generated.vaultKey,
      },
    })
    expect(opened).toEqual({
      kind: "unsigned",
      plaintext,
      messageId,
      createdAt,
    })
  })

  it("runs sign-then-encrypt and releases plaintext only after verification", async () => {
    const pq = client()
    const generated = await identity(pq, 41)
    const plaintext = new TextEncoder().encode("signed worker round trip")
    const messageId = new Uint8Array(16).fill(0x42)
    const createdAt = 1_700_000_000_002
    const envelope = await pq.encryptPqMessage({
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: generated.identity.kem.keyId,
      recipientKemPublicKey: generated.identity.kem.publicKey,
      plaintext,
      messageId,
      createdAt,
      sign: {
        senderSigningKeyId: generated.identity.signing.keyId,
        algorithm: generated.identity.signing.algorithm,
        vaultKey: generated.vaultKey,
        identityId: generated.identity.id,
        encryptedSeed: generated.identity.signing.encryptedSeed,
        storedPublicKey: generated.identity.signing.publicKey,
      },
    })
    const opened = await pq.openPqEnvelope({
      envelope,
      recipient: {
        identityId: generated.identity.id,
        kemAlgorithm: generated.identity.kem.algorithm,
        kemKeyId: generated.identity.kem.keyId,
        encryptedKemSeed: generated.identity.kem.encryptedSeed,
        storedKemPublicKey: generated.identity.kem.publicKey,
        vaultKey: generated.vaultKey,
      },
    })
    expect(opened.kind).toBe("signed")
    expect("plaintext" in opened).toBe(false)
    if (opened.kind !== "signed") throw new Error("expected signed result")
    const verified = await pq.verifySignedMessage({
      signedMessageBytes: opened.signedMessageBytes,
      senderPublicKey: generated.identity.signing.publicKey,
      algorithm: generated.identity.signing.algorithm,
    })
    expect(verified).toEqual({
      valid: true,
      plaintext,
      messageId,
      createdAt,
    })

    const result = await decryptPqMessage({
      client: pq,
      envelope,
      recipient: generated.identity,
      vaultKey: generated.vaultKey,
      resolveSigningKey: async (id) =>
        id === generated.identity.signing.keyId
          ? {
              algorithm: generated.identity.signing.algorithm,
              publicKey: generated.identity.signing.publicKey,
              revoked: false,
            }
          : undefined,
    })
    expect(result).toEqual({
      kind: "signed-valid",
      plaintext,
      messageId,
      createdAt,
      senderSigningKeyId: generated.identity.signing.keyId,
    })
  })

  it("rejects KEM ct, salt, IV, suite, keyId, and GCM tag tampering", async () => {
    const pq = client()
    const generated = await identity(pq, 51)
    const envelope = await pq.encryptPqMessage({
      suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
      recipientKemKeyId: generated.identity.kem.keyId,
      recipientKemPublicKey: generated.identity.kem.publicKey,
      plaintext: new TextEncoder().encode("tamper matrix"),
      messageId: new Uint8Array(16).fill(0x43),
      createdAt: 1_700_000_000_003,
    })
    const mutations: Array<(value: MlKemMessageEnvelopeV2) => void> = [
      (value) => {
        value.kemCiphertext[0] = value.kemCiphertext[0]! ^ 1
      },
      (value) => {
        value.hkdfSalt[0] = value.hkdfSalt[0]! ^ 1
      },
      (value) => {
        value.iv[0] = value.iv[0]! ^ 1
      },
      (value) => {
        const last = value.ciphertext.byteLength - 1
        value.ciphertext[last] = value.ciphertext[last]! ^ 1
      },
      (value) => {
        value.suite = "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
      },
      (value) => {
        value.recipientKemKeyId = keyId(99)
      },
    ]
    for (const mutate of mutations) {
      const tampered = cloneEnvelope(envelope)
      mutate(tampered)
      await expect(
        pq.openPqEnvelope({
          envelope: tampered,
          recipient: {
            identityId: generated.identity.id,
            kemAlgorithm: generated.identity.kem.algorithm,
            kemKeyId: generated.identity.kem.keyId,
            encryptedKemSeed: generated.identity.kem.encryptedSeed,
            storedKemPublicKey: generated.identity.kem.publicKey,
            vaultKey: generated.vaultKey,
          },
        }),
      ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
    }
  })

  it("rejects stored-public-key replacement before seed use", async () => {
    const pq = client()
    const generated = await identity(pq, 61)
    const replacedPublicKey = Uint8Array.from(generated.identity.kem.publicKey)
    replacedPublicKey[0] = replacedPublicKey[0]! ^ 1
    await expect(
      pq.publicKeysFromSeeds({
        vaultKey: generated.vaultKey,
        identityId: generated.identity.id,
        kem: {
          algorithm: generated.identity.kem.algorithm,
          keyId: generated.identity.kem.keyId,
          encryptedSeed: generated.identity.kem.encryptedSeed,
          storedPublicKey: replacedPublicKey,
        },
        signing: {
          algorithm: generated.identity.signing.algorithm,
          keyId: generated.identity.signing.keyId,
          encryptedSeed: generated.identity.signing.encryptedSeed,
          storedPublicKey: generated.identity.signing.publicKey,
        },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })

  it("returns no plaintext for a tampered signed message", async () => {
    const pq = client()
    const generated = await identity(pq, 71)
    const envelope = await pq.encryptPqMessage({
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: generated.identity.kem.keyId,
      recipientKemPublicKey: generated.identity.kem.publicKey,
      plaintext: new TextEncoder().encode("never expose on invalid signature"),
      messageId: new Uint8Array(16).fill(0x44),
      createdAt: 1_700_000_000_004,
      sign: {
        senderSigningKeyId: generated.identity.signing.keyId,
        algorithm: generated.identity.signing.algorithm,
        vaultKey: generated.vaultKey,
        identityId: generated.identity.id,
        encryptedSeed: generated.identity.signing.encryptedSeed,
        storedPublicKey: generated.identity.signing.publicKey,
      },
    })
    const opened = await pq.openPqEnvelope({
      envelope,
      recipient: {
        identityId: generated.identity.id,
        kemAlgorithm: generated.identity.kem.algorithm,
        kemKeyId: generated.identity.kem.keyId,
        encryptedKemSeed: generated.identity.kem.encryptedSeed,
        storedKemPublicKey: generated.identity.kem.publicKey,
        vaultKey: generated.vaultKey,
      },
    })
    if (opened.kind !== "signed") throw new Error("expected signed result")
    const signed = decodeSignedMessageV2(opened.signedMessageBytes)
    signed.signature.value[0] = signed.signature.value[0]! ^ 1
    const tamperedBytes = encodeSignedMessageV2(signed)
    const result = await pq.verifySignedMessage({
      signedMessageBytes: tamperedBytes,
      senderPublicKey: generated.identity.signing.publicKey,
      algorithm: generated.identity.signing.algorithm,
    })
    expect(result).toEqual({ valid: false })
    expect("plaintext" in result).toBe(false)
  })
})
