import { describe, expect, it, vi } from "vitest"
import { encodeSignedMessageV2 } from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { createIdentity, rotateIdentity } from "@/crypto/pq/identity"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import {
  DSA_SIZES,
  maxEnvelopeCiphertextBytes,
  maxSignedMessageBytes,
} from "@/crypto/pq/profiles"
import { suiteComponents } from "@/crypto/pq/suites"
import type { PqCryptoClient, PqWorkerOperation } from "@/crypto/pq/worker-client"
import { toBase64Url } from "@/lib/base64url"
import { MAX_PLAINTEXT_BYTES } from "@/lib/limits"
import {
  ML_DSA_ALGORITHMS,
  WIRE_SUITES,
  type MlKemMessageEnvelopeV2,
  type PostQuantumIdentity,
  type PqPublicBundleRecord,
} from "@/schemas/domain"
import { handlePqWorkerRequest } from "@/workers/pq-crypto.worker"

function keyId(fill: number): string {
  return toBase64Url(new Uint8Array(16).fill(fill))
}

async function vaultKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, [
    "encrypt",
    "decrypt",
  ])
}

function legacyIdentity(): PostQuantumIdentity {
  return {
    id: keyId(1),
    name: "legacy balanced",
    profile: "balanced",
    kem: {
      algorithm: "ML-KEM-768",
      keyId: keyId(2),
      publicKey: new Uint8Array(1184),
      encryptedSeed: {
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(80),
      },
      fingerprint: "1".repeat(64),
    },
    signing: {
      algorithm: "ML-DSA-65",
      keyId: keyId(3),
      publicKey: new Uint8Array(1952),
      encryptedSeed: {
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(48),
      },
      fingerprint: "2".repeat(64),
    },
    identityFingerprint: "3".repeat(64),
    status: "active",
    createdAt: 1_700_000_000_000,
  }
}

function legacyBundle(identity = legacyIdentity()): PqPublicBundleRecord {
  return {
    recordId: keyId(4),
    identityId: identity.id,
    name: identity.name,
    kem: {
      algorithm: identity.kem.algorithm,
      keyId: identity.kem.keyId,
      publicKey: identity.kem.publicKey,
      fingerprint: identity.kem.fingerprint,
    },
    signing: {
      algorithm: identity.signing.algorithm,
      keyId: identity.signing.keyId,
      publicKey: identity.signing.publicKey,
      fingerprint: identity.signing.fingerprint,
    },
    identityFingerprint: identity.identityFingerprint,
    trust: "fingerprint-confirmed",
    trustConfirmedAt: identity.createdAt + 2,
    bundleCreatedAt: identity.createdAt,
    importedAt: identity.createdAt + 1,
  }
}

function legacyEnvelope(signed = true): MlKemMessageEnvelopeV2 {
  return {
    version: 2,
    type: "pq-message",
    suite: signed
      ? "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM"
      : "ML-KEM-768+HKDF-SHA256+A256GCM",
    recipientKemKeyId: keyId(2),
    kemCiphertext: new Uint8Array(1088),
    hkdfSalt: new Uint8Array(32),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(16),
  }
}

function clientDouble(): {
  client: PqCryptoClient
  generateIdentityKeys: ReturnType<typeof vi.fn>
  encryptPqMessage: ReturnType<typeof vi.fn>
  openPqEnvelope: ReturnType<typeof vi.fn>
} {
  const generateIdentityKeys = vi.fn()
  const encryptPqMessage = vi.fn()
  const openPqEnvelope = vi.fn()
  return {
    generateIdentityKeys,
    encryptPqMessage,
    openPqEnvelope,
    client: {
      generateIdentityKeys,
      publicKeysFromSeeds: vi.fn(),
      signWithSeed: vi.fn(),
      verify: vi.fn(),
      encryptPqMessage,
      openPqEnvelope,
      verifySignedMessage: vi.fn(),
      dispose: vi.fn(),
    } as unknown as PqCryptoClient,
  }
}

describe("maximum active-policy boundaries", () => {
  it("rejects balanced identity creation before key generation", async () => {
    const pq = clientDouble()
    await expect(
      createIdentity({
        client: pq.client,
        vaultKey: await vaultKey(),
        name: "legacy",
        profile: "balanced",
        now: 1_700_000_000_001,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
    expect(pq.generateIdentityKeys).not.toHaveBeenCalled()
  })

  it("rejects rotation of a stored balanced identity before key generation", async () => {
    const pq = clientDouble()
    await expect(
      rotateIdentity({
        client: pq.client,
        vaultKey: await vaultKey(),
        current: legacyIdentity(),
        now: 1_700_000_000_001,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
    expect(pq.generateIdentityKeys).not.toHaveBeenCalled()
  })

  it("rejects every 768/65 operation when the Worker RPC handler is called directly", async () => {
    const identity = legacyIdentity()
    const key = await vaultKey()
    const signedMessageBytes = encodeSignedMessageV2({
      body: {
        version: 2,
        messageId: new Uint8Array(16),
        createdAt: identity.createdAt,
        recipientKemKeyId: identity.kem.keyId,
        plaintext: new Uint8Array(),
        senderSigningKeyId: identity.signing.keyId,
      },
      signature: {
        algorithm: "ML-DSA-65",
        value: new Uint8Array(3309),
      },
    })
    const cases: Array<{
      operation: PqWorkerOperation
      payload: unknown
    }> = [
      {
        operation: "generateIdentityKeys",
        payload: {
          profile: "balanced",
          vaultKey: key,
          identityId: identity.id,
          kemKeyId: identity.kem.keyId,
          signingKeyId: identity.signing.keyId,
        },
      },
      {
        operation: "publicKeysFromSeeds",
        payload: {
          vaultKey: key,
          identityId: identity.id,
          kem: {
            algorithm: identity.kem.algorithm,
            keyId: identity.kem.keyId,
            encryptedSeed: identity.kem.encryptedSeed,
            storedPublicKey: identity.kem.publicKey,
          },
          signing: {
            algorithm: identity.signing.algorithm,
            keyId: identity.signing.keyId,
            encryptedSeed: identity.signing.encryptedSeed,
            storedPublicKey: identity.signing.publicKey,
          },
        },
      },
      {
        operation: "signWithSeed",
        payload: {
          algorithm: identity.signing.algorithm,
          vaultKey: key,
          identityId: identity.id,
          keyId: identity.signing.keyId,
          encryptedSeed: identity.signing.encryptedSeed,
          storedPublicKey: identity.signing.publicKey,
          message: new Uint8Array(),
        },
      },
      {
        operation: "verify",
        payload: {
          algorithm: identity.signing.algorithm,
          publicKey: identity.signing.publicKey,
          message: new Uint8Array(),
          signature: new Uint8Array(3309),
        },
      },
      {
        operation: "encryptPqMessage",
        payload: {
          suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
          recipientKemKeyId: identity.kem.keyId,
          recipientKemPublicKey: identity.kem.publicKey,
          plaintext: new Uint8Array(),
          messageId: new Uint8Array(16),
          createdAt: identity.createdAt,
        },
      },
      {
        operation: "openPqEnvelope",
        payload: {
          envelope: legacyEnvelope(),
          recipient: {
            identityId: identity.id,
            kemAlgorithm: identity.kem.algorithm,
            kemKeyId: identity.kem.keyId,
            encryptedKemSeed: identity.kem.encryptedSeed,
            storedKemPublicKey: identity.kem.publicKey,
            vaultKey: key,
          },
        },
      },
      {
        operation: "verifySignedMessage",
        payload: {
          signedMessageBytes,
          senderPublicKey: identity.signing.publicKey,
          algorithm: identity.signing.algorithm,
        },
      },
    ]

    for (const [index, testCase] of cases.entries()) {
      await expect(
        handlePqWorkerRequest({
          id: `legacy-${index}`,
          operation: testCase.operation,
          payload: testCase.payload,
        }),
      ).resolves.toEqual({
        id: `legacy-${index}`,
        ok: false,
        code: "UNSUPPORTED_ALGORITHM",
      })
    }
  })

  it("rejects encryptPq with a 768 recipient before invoking the Worker client", async () => {
    const pq = clientDouble()
    await expect(
      encryptPq({
        client: pq.client,
        recipient: legacyBundle(),
        plaintext: new Uint8Array(),
        now: 1_700_000_000_001,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
    expect(pq.encryptPqMessage).not.toHaveBeenCalled()
  })

  it("rejects a 768 decrypt envelope before cryptography or key lookup", async () => {
    const pq = clientDouble()
    const resolveSigningKey = vi.fn()
    await expect(
      decryptPqMessage({
        client: pq.client,
        envelope: legacyEnvelope(),
        recipient: legacyIdentity(),
        vaultKey: await vaultKey(),
        resolveSigningKey,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
    expect(pq.openPqEnvelope).not.toHaveBeenCalled()
    expect(resolveSigningKey).not.toHaveBeenCalled()
  })
})

describe("derived ciphertext ceilings", () => {
  it.each(WIRE_SUITES)("derives the envelope ciphertext ceiling for %s", (suite) => {
    const { signature } = suiteComponents(suite)
    const expected =
      signature === undefined
        ? MAX_PLAINTEXT_BYTES + 512 + 16
        : MAX_PLAINTEXT_BYTES + DSA_SIZES[signature].signatureBytes + 1024 + 16
    expect(maxEnvelopeCiphertextBytes(suite)).toBe(expected)
  })

  it.each(ML_DSA_ALGORITHMS)(
    "derives the signed-message ceiling for %s",
    (algorithm) => {
      expect(maxSignedMessageBytes(algorithm)).toBe(
        MAX_PLAINTEXT_BYTES + DSA_SIZES[algorithm].signatureBytes + 1024,
      )
    },
  )
})
