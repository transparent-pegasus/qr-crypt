import { describe, expect, it, vi } from "vitest"
import {
  decodeMlKemEnvelopeV2,
  decodePublicIdentityBundleV2,
  encodeCanonicalCbor,
} from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { createIdentity, rotateIdentity } from "@/crypto/pq/identity"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import {
  DSA_SIZES,
  KEM_SIZES,
  maxEnvelopeCiphertextBytes,
  maxSignedMessageBytes,
  PQ_PROFILES,
} from "@/crypto/pq/profiles"
import {
  assertActiveSuite,
  resolveSuite,
  suiteComponents,
} from "@/crypto/pq/suites"
import {
  validateMlKemEnvelopeV2,
  validatePublicIdentityBundleV2,
} from "@/crypto/pq/validation"
import type { PqCryptoClient, PqWorkerOperation } from "@/crypto/pq/worker-client"
import { toBase64Url } from "@/lib/base64url"
import {
  ML_DSA_ALGORITHMS,
  ML_KEM_ALGORITHMS,
  PQ_PROFILE_IDS,
  WIRE_SUITES,
  type MlKemMessageEnvelopeV2,
  type MlDsaAlgorithm,
  type PostQuantumIdentity,
  type PqPublicBundleRecord,
  type WireSuite,
} from "@/schemas/domain"
import { validatePostQuantumIdentity } from "@/schemas/key-schema"
import { handlePqWorkerRequest } from "@/workers/pq-crypto.worker"

const SIGNED_SUITE = "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
const REMOVED_WIRE_SUITES = [
  {
    suite: "ML-KEM-1024+HKDF-SHA256+A256GCM",
    kemCiphertextBytes: 1_568,
  },
  {
    suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
    kemCiphertextBytes: 1_088,
  },
  {
    suite: "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM",
    kemCiphertextBytes: 1_088,
  },
] as const

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
  } as unknown as PostQuantumIdentity
}

function activeIdentity(): PostQuantumIdentity {
  return {
    ...legacyIdentity(),
    name: "active maximum",
    profile: "maximum",
    kem: {
      ...legacyIdentity().kem,
      algorithm: "ML-KEM-1024",
      publicKey: new Uint8Array(1_568),
    },
    signing: {
      ...legacyIdentity().signing,
      algorithm: "ML-DSA-87",
      publicKey: new Uint8Array(2_592),
    },
  }
}

function legacyBundle(): PqPublicBundleRecord {
  const identity = legacyIdentity()
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

function legacyEnvelope(): MlKemMessageEnvelopeV2 {
  return {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM",
    recipientKemKeyId: keyId(2),
    kemCiphertext: new Uint8Array(1088),
    hkdfSalt: new Uint8Array(32),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(16),
  } as unknown as MlKemMessageEnvelopeV2
}

function removedSuiteEnvelope({
  suite,
  kemCiphertextBytes,
}: (typeof REMOVED_WIRE_SUITES)[number]) {
  return {
    version: 2,
    type: "pq-message",
    suite,
    recipientKemKeyId: keyId(2),
    kemCiphertext: new Uint8Array(kemCiphertextBytes),
    hkdfSalt: new Uint8Array(32),
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(16),
  }
}

function removedPublicBundle() {
  return {
    version: 2,
    type: "pq-public-identity",
    identityId: keyId(1),
    kem: {
      algorithm: "ML-KEM-768",
      keyId: keyId(2),
      publicKey: new Uint8Array(1_184),
    },
    signing: {
      algorithm: "ML-DSA-65",
      keyId: keyId(3),
      publicKey: new Uint8Array(1_952),
    },
    createdAt: 1_700_000_000_000,
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
        profile: "balanced" as never,
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
    const signedMessageBytes = encodeCanonicalCbor({
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
        sign: { identity: activeIdentity(), vaultKey: await vaultKey() },
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

describe("single active post-quantum vocabulary", () => {
  it("exports exactly the one signed suite and maximum algorithms", () => {
    expect(WIRE_SUITES).toEqual([SIGNED_SUITE])
    expect(ML_KEM_ALGORITHMS).toEqual(["ML-KEM-1024"])
    expect(ML_DSA_ALGORITHMS).toEqual(["ML-DSA-87"])
    expect(PQ_PROFILE_IDS).toEqual(["maximum"])
  })

  it("keeps only maximum rows in the profile size tables", () => {
    expect(Object.keys(KEM_SIZES)).toEqual(["ML-KEM-1024"])
    expect(Object.keys(DSA_SIZES)).toEqual(["ML-DSA-87"])
    expect(Object.keys(PQ_PROFILES)).toEqual(["maximum"])
  })

  it.each([
    ["a missing KEM", undefined, "ML-DSA-87"],
    ["a missing signature", "ML-KEM-1024", undefined],
    ["the retired 768/65 pair", "ML-KEM-768", "ML-DSA-65"],
  ] as const)("rejects %s in resolveSuite", (_label, kem, signature) => {
    expect(() => resolveSuite(kem as never, signature as never)).toThrowError(
      expect.objectContaining({ code: "UNSUPPORTED_ALGORITHM" }),
    )
  })

  it("resolves and decomposes only the signed maximum suite", () => {
    expect(resolveSuite("ML-KEM-1024", "ML-DSA-87")).toBe(SIGNED_SUITE)
    expect(suiteComponents(SIGNED_SUITE)).toEqual({
      kem: "ML-KEM-1024",
      signature: "ML-DSA-87",
    })
    expect(WIRE_SUITES.map((suite) => suiteComponents(suite).signature)).toEqual([
      "ML-DSA-87",
    ])
  })

  it.each(REMOVED_WIRE_SUITES)(
    "rejects removed suite $suite at the active-policy boundary",
    ({ suite }) => {
      expect(() => assertActiveSuite(suite as never)).toThrowError(
        expect.objectContaining({ code: "UNSUPPORTED_ALGORITHM" }),
      )
    },
  )

  it.each(REMOVED_WIRE_SUITES)(
    "rejects removed suite $suite at the canonical decoder boundary",
    (removedSuite) => {
      const encoded = encodeCanonicalCbor(
        removedSuiteEnvelope(removedSuite) as never,
      )
      expect(() => decodeMlKemEnvelopeV2(encoded)).toThrowError(
        expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
      )
    },
  )

  it.each(REMOVED_WIRE_SUITES)(
    "rejects removed suite $suite at the strict validator boundary",
    (removedSuite) => {
      expect(() =>
        validateMlKemEnvelopeV2(removedSuiteEnvelope(removedSuite)),
      ).toThrowError(expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }))
    },
  )

  it("rejects ML-KEM-768 and ML-DSA-65 at the public-bundle decoder boundary", () => {
    const encoded = encodeCanonicalCbor(removedPublicBundle() as never)
    expect(() => decodePublicIdentityBundleV2(encoded)).toThrowError(
      expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
    )
  })

  it("rejects ML-KEM-768 and ML-DSA-65 at the public-bundle validator boundary", () => {
    expect(() => validatePublicIdentityBundleV2(removedPublicBundle())).toThrowError(
      expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
    )
  })

  it("rejects the balanced profile at the stored-identity validator boundary", () => {
    expect(() => validatePostQuantumIdentity(legacyIdentity())).toThrow()
  })
})

const EXPECTED_ENVELOPE_CEILING = {
  "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM": 125_667,
} as const
const EXPECTED_SIGNED_MESSAGE_CEILING = {
  "ML-DSA-87": 125_651,
} as const

describe("derived ciphertext ceilings", () => {
  it.each(Object.entries(EXPECTED_ENVELOPE_CEILING))(
    "pins the envelope ciphertext ceiling for %s",
    (suite, expected) => {
      expect(maxEnvelopeCiphertextBytes(suite as WireSuite)).toBe(expected)
    },
  )

  it.each(Object.entries(EXPECTED_SIGNED_MESSAGE_CEILING))(
    "pins the signed-message ceiling for %s",
    (algorithm, expected) => {
      expect(maxSignedMessageBytes(algorithm as MlDsaAlgorithm)).toBe(expected)
    },
  )
})
