import { afterEach, describe, expect, it } from "vitest"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { decodeSignedMessageV2, encodeSignedMessageV2 } from "@/crypto/pq/canonical-cbor"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { closeDb, deleteEntireDatabase } from "@/storage/database"
import { toBase64Url } from "@/lib/base64url"
import type { PostQuantumIdentity } from "@/schemas/domain"
import { createInProcessPqClient } from "../setup/pq-in-process-client"

const clients = new Set<PqCryptoClient>()

function keyId(fill: number): string {
  return toBase64Url(new Uint8Array(16).fill(fill))
}

function client(): PqCryptoClient {
  const value = createInProcessPqClient()
  clients.add(value)
  return value
}

async function identity(
  pq: PqCryptoClient,
  fill: number,
): Promise<{ identity: PostQuantumIdentity; vaultKey: CryptoKey }> {
  const vaultKey = await getOrCreateVaultKey()
  const identityId = keyId(fill)
  const kemKeyId = keyId(fill + 1)
  const signingKeyId = keyId(fill + 2)
  const generated = await pq.generateIdentityKeys({
    profile: "maximum",
    vaultKey,
    identityId,
    kemKeyId,
    signingKeyId,
  })
  return {
    vaultKey,
    identity: {
      id: identityId,
      name: `identity-${fill}`,
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
      createdAt: 1_700_000_000_000,
    },
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
        profile: "balanced" as never,
        vaultKey: await getOrCreateVaultKey(),
        identityId: keyId(1),
        kemKeyId: keyId(2),
        signingKeyId: keyId(3),
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
  })

  it("rejects a tampered stored KEM key before opening", async () => {
    const pq = client()
    const generated = await identity(pq, 11)
    const envelope = await pq.encryptPqMessage({
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: generated.identity.kem.keyId,
      recipientKemPublicKey: generated.identity.kem.publicKey,
      plaintext: new TextEncoder().encode("KEM key binding"),
      messageId: new Uint8Array(16).fill(0x12),
      createdAt: 1_700_000_000_001,
      sign: {
        senderSigningKeyId: generated.identity.signing.keyId,
        algorithm: generated.identity.signing.algorithm,
        vaultKey: generated.vaultKey,
        identityId: generated.identity.id,
        encryptedSeed: generated.identity.signing.encryptedSeed,
        storedPublicKey: generated.identity.signing.publicKey,
      },
    })
    const replacedPublicKey = Uint8Array.from(generated.identity.kem.publicKey)
    replacedPublicKey[0] = replacedPublicKey[0]! ^ 1
    await expect(
      pq.openPqEnvelope({
        envelope,
        recipient: {
          identityId: generated.identity.id,
          kemAlgorithm: generated.identity.kem.algorithm,
          kemKeyId: generated.identity.kem.keyId,
          encryptedKemSeed: generated.identity.kem.encryptedSeed,
          storedKemPublicKey: replacedPublicKey,
          vaultKey: generated.vaultKey,
        },
      }),
    ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  })

  it("rejects a tampered stored signing key before encryption", async () => {
    const pq = client()
    const generated = await identity(pq, 21)
    const replacedPublicKey = Uint8Array.from(generated.identity.signing.publicKey)
    replacedPublicKey[0] = replacedPublicKey[0]! ^ 1
    await expect(
      pq.encryptPqMessage({
        suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
        recipientKemKeyId: generated.identity.kem.keyId,
        recipientKemPublicKey: generated.identity.kem.publicKey,
        plaintext: new TextEncoder().encode("signing key binding"),
        messageId: new Uint8Array(16).fill(0x22),
        createdAt: 1_700_000_000_001,
        sign: {
          senderSigningKeyId: generated.identity.signing.keyId,
          algorithm: generated.identity.signing.algorithm,
          vaultKey: generated.vaultKey,
          identityId: generated.identity.id,
          encryptedSeed: generated.identity.signing.encryptedSeed,
          storedPublicKey: replacedPublicKey,
        },
      }),
    ).rejects.toMatchObject({ code: "ENCRYPTION_FAILED" })
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
      plaintext: Uint8Array.from(plaintext),
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
