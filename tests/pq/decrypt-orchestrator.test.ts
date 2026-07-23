import { describe, expect, it, vi } from "vitest"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type { MlKemMessageEnvelopeV2, PostQuantumIdentity } from "@/schemas/domain"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const SENDER_ID = "EAESExQVFhcYGRobHB0eHw"

const envelope: MlKemMessageEnvelopeV2 = {
  version: 2,
  type: "pq-message",
  suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
  recipientKemKeyId: KEY_ID,
  kemCiphertext: new Uint8Array(1568),
  hkdfSalt: new Uint8Array(32),
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(16),
}

const recipient: PostQuantumIdentity = {
  id: KEY_ID,
  name: "recipient",
  profile: "maximum",
  kem: {
    algorithm: "ML-KEM-1024",
    keyId: KEY_ID,
    publicKey: new Uint8Array(1568),
    encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(80) },
    fingerprint: "kem",
  },
  signing: {
    algorithm: "ML-DSA-87",
    keyId: SENDER_ID,
    publicKey: new Uint8Array(2592),
    encryptedSeed: { iv: new Uint8Array(12), ciphertext: new Uint8Array(48) },
    fingerprint: "dsa",
  },
  identityFingerprint: "identity",
  status: "active",
  createdAt: 1,
}

function fakeClient(overrides: Partial<PqCryptoClient>): PqCryptoClient {
  const unavailable = async (): Promise<never> => {
    throw new Error("unexpected call")
  }
  return {
    generateIdentityKeys: unavailable,
    publicKeysFromSeeds: unavailable,
    signWithSeed: unavailable,
    verify: unavailable,
    encryptPqMessage: unavailable,
    openPqEnvelope: unavailable,
    verifySignedMessage: unavailable,
    dispose: vi.fn(),
    ...overrides,
  }
}

describe("decryptPqMessage", () => {
  it("returns unknown signer without constructing plaintext or invoking verify", async () => {
    const signedMessageBytes = new Uint8Array([1, 2, 3])
    const verifySignedMessage = vi.fn()
    const client = fakeClient({
      openPqEnvelope: vi.fn().mockResolvedValue({
        kind: "signed",
        signedMessageBytes,
        senderSigningKeyId: SENDER_ID,
        signatureAlgorithm: "ML-DSA-87",
      }),
      verifySignedMessage,
    })
    const result = await decryptPqMessage({
      client,
      envelope,
      recipient,
      vaultKey: {} as CryptoKey,
      resolveSigningKey: vi.fn().mockResolvedValue(undefined),
    })
    expect(result).toEqual({
      kind: "signed-key-unknown",
      senderSigningKeyId: SENDER_ID,
    })
    expect("plaintext" in result).toBe(false)
    expect(verifySignedMessage).not.toHaveBeenCalled()
    expect(signedMessageBytes).toEqual(new Uint8Array(3))
  })

  it("treats revoked senders as unknown without plaintext", async () => {
    const client = fakeClient({
      openPqEnvelope: vi.fn().mockResolvedValue({
        kind: "signed",
        signedMessageBytes: new Uint8Array([1]),
        senderSigningKeyId: SENDER_ID,
        signatureAlgorithm: "ML-DSA-87",
      }),
    })
    const result = await decryptPqMessage({
      client,
      envelope,
      recipient,
      vaultKey: {} as CryptoKey,
      resolveSigningKey: vi.fn().mockResolvedValue({
        algorithm: "ML-DSA-87",
        publicKey: new Uint8Array(2592),
        revoked: true,
      }),
    })
    expect(result.kind).toBe("signed-key-unknown")
    expect("plaintext" in result).toBe(false)
  })

  it("throws SIGNATURE_INVALID without plaintext on verify failure", async () => {
    const client = fakeClient({
      openPqEnvelope: vi.fn().mockResolvedValue({
        kind: "signed",
        signedMessageBytes: new Uint8Array([1]),
        senderSigningKeyId: SENDER_ID,
        signatureAlgorithm: "ML-DSA-87",
      }),
      verifySignedMessage: vi.fn().mockResolvedValue({ valid: false }),
    })
    await expect(
      decryptPqMessage({
        client,
        envelope,
        recipient,
        vaultKey: {} as CryptoKey,
        resolveSigningKey: vi.fn().mockResolvedValue({
          algorithm: "ML-DSA-87",
          publicKey: new Uint8Array(2592),
          revoked: false,
        }),
      }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" })
  })

  it("returns plaintext only after valid verification", async () => {
    const plaintext = new TextEncoder().encode("verified")
    const client = fakeClient({
      openPqEnvelope: vi.fn().mockResolvedValue({
        kind: "signed",
        signedMessageBytes: new Uint8Array([1]),
        senderSigningKeyId: SENDER_ID,
        signatureAlgorithm: "ML-DSA-87",
      }),
      verifySignedMessage: vi.fn().mockResolvedValue({ valid: true, plaintext }),
    })
    await expect(
      decryptPqMessage({
        client,
        envelope,
        recipient,
        vaultKey: {} as CryptoKey,
        resolveSigningKey: vi.fn().mockResolvedValue({
          algorithm: "ML-DSA-87",
          publicKey: new Uint8Array(2592),
          revoked: false,
        }),
      }),
    ).resolves.toEqual({
      kind: "signed-valid",
      plaintext,
      senderSigningKeyId: SENDER_ID,
    })
  })
})
