import { afterEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/crypto/errors"
import {
  decodeCanonicalCbor,
  decodeSignedMessageV2,
  encodeCanonicalCbor,
  encodeMlKemAadV2,
  encodeMlKemEnvelopeV2,
  encodeSignedMessageV2,
  type CanonicalCborValue,
} from "@/crypto/pq/canonical-cbor"
import { decryptPqMessage } from "@/crypto/pq/decrypt-orchestrator"
import { createNobleDsa87, createNobleKem1024 } from "@/crypto/pq/provider-noble"
import { createPqCryptoClient } from "@/crypto/pq/worker-client"
import { hkdfInfoV2, buildVaultAadV2 } from "@/crypto/pq/wire-bytes"
import { zeroize, withZeroize } from "@/crypto/pq/zeroize"
import { toBase64Url } from "@/lib/base64url"
import {
  bytesEqual,
  bytesToHex,
  sha256,
  sha256Hex,
  toOwnedArrayBuffer,
} from "@/lib/bytes"
import type {
  EncryptedSecret,
  MlKemMessageEnvelopeV2,
  PostQuantumIdentity,
} from "@/schemas/domain"

const IDENTITY_ID = toBase64Url(new Uint8Array(16).fill(0x11))
const KEM_KEY_ID = toBase64Url(new Uint8Array(16).fill(0x22))
const SIGNING_KEY_ID = toBase64Url(new Uint8Array(16).fill(0x33))
const OTHER_KEY_ID = toBase64Url(new Uint8Array(16).fill(0x44))
const KEM_SEED = new Uint8Array(64).map((_, index) => index)
const DSA_SEED = new Uint8Array(32).map((_, index) => 0x80 + index)
const MESSAGE_ID = new Uint8Array(16).fill(0x55)
const CREATED_AT = 1_700_000_000_123

async function fixedVaultKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new Uint8Array(32).fill(0x99),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  )
}

async function encryptFixedSeed(args: {
  key: CryptoKey
  seed: Uint8Array
  ivByte: number
  aad: Parameters<typeof buildVaultAadV2>[0]
}): Promise<EncryptedSecret> {
  const iv = new Uint8Array(12).fill(args.ivByte)
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv: toOwnedArrayBuffer(iv),
        additionalData: toOwnedArrayBuffer(buildVaultAadV2(args.aad)),
        tagLength: 128,
      },
      args.key,
      toOwnedArrayBuffer(args.seed),
    ),
  )
  return { iv, ciphertext }
}

interface Fixture {
  client: ReturnType<typeof createPqCryptoClient>
  identity: PostQuantumIdentity
  vaultKey: CryptoKey
  envelope: MlKemMessageEnvelopeV2
  plaintext: Uint8Array
}

async function compositionFixture(): Promise<Fixture> {
  const kem = createNobleKem1024()
  const dsa = createNobleDsa87()
  const kemKeys = kem.keygen(KEM_SEED)
  const dsaKeys = dsa.keygen(DSA_SEED)
  const vaultKey = await fixedVaultKey()
  const [encryptedKemSeed, encryptedDsaSeed] = await Promise.all([
    encryptFixedSeed({
      key: vaultKey,
      seed: KEM_SEED,
      ivByte: 0x61,
      aad: {
        identityId: IDENTITY_ID,
        role: "ml-kem-seed",
        algorithm: "ML-KEM-1024",
        keyId: KEM_KEY_ID,
        publicKeySha256: await sha256(kemKeys.publicKey),
      },
    }),
    encryptFixedSeed({
      key: vaultKey,
      seed: DSA_SEED,
      ivByte: 0x62,
      aad: {
        identityId: IDENTITY_ID,
        role: "ml-dsa-seed",
        algorithm: "ML-DSA-87",
        keyId: SIGNING_KEY_ID,
        publicKeySha256: await sha256(dsaKeys.publicKey),
      },
    }),
  ])
  const identity: PostQuantumIdentity = {
    id: IDENTITY_ID,
    name: "composition fixture",
    profile: "maximum",
    kem: {
      algorithm: "ML-KEM-1024",
      keyId: KEM_KEY_ID,
      publicKey: kemKeys.publicKey,
      encryptedSeed: encryptedKemSeed,
      fingerprint: "fixture-kem",
    },
    signing: {
      algorithm: "ML-DSA-87",
      keyId: SIGNING_KEY_ID,
      publicKey: dsaKeys.publicKey,
      encryptedSeed: encryptedDsaSeed,
      fingerprint: "fixture-dsa",
    },
    identityFingerprint: "fixture-identity",
    status: "active",
    createdAt: CREATED_AT,
  }
  zeroize(kemKeys.secretKey, dsaKeys.secretKey)

  const randomOutputs = [
    new Uint8Array(32).fill(0xa1), // ML-DSA signing randomness
    new Uint8Array(32).fill(0xa2), // ML-KEM encapsulation message
    new Uint8Array(32).fill(0xa3), // HKDF salt
    new Uint8Array(12).fill(0xa4), // AES-GCM IV
  ]
  let randomIndex = 0
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => {
    const output = randomOutputs[randomIndex++]
    if (output === undefined || output.byteLength !== array.byteLength) {
      throw new Error(`unexpected random request ${array.byteLength}`)
    }
    new Uint8Array(array.buffer, array.byteOffset, array.byteLength).set(output)
    return array
  })

  const client = createPqCryptoClient()
  const plaintext = new TextEncoder().encode("fixed composition plaintext")
  const envelope = await client.encryptPqMessage({
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEM_KEY_ID,
    recipientKemPublicKey: identity.kem.publicKey,
    plaintext,
    messageId: MESSAGE_ID,
    createdAt: CREATED_AT,
    sign: {
      senderSigningKeyId: SIGNING_KEY_ID,
      algorithm: "ML-DSA-87",
      vaultKey,
      identityId: IDENTITY_ID,
      encryptedSeed: encryptedDsaSeed,
      storedPublicKey: identity.signing.publicKey,
    },
  })
  expect(randomIndex).toBe(4)
  return { client, identity, vaultKey, envelope, plaintext }
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

function recipient(fixture: Fixture, envelope = fixture.envelope) {
  return {
    envelope,
    recipient: {
      identityId: fixture.identity.id,
      kemAlgorithm: fixture.identity.kem.algorithm,
      kemKeyId: fixture.identity.kem.keyId,
      encryptedKemSeed: fixture.identity.kem.encryptedSeed,
      storedKemPublicKey: fixture.identity.kem.publicKey,
      vaultKey: fixture.vaultKey,
    },
  }
}

async function innerCrypto(fixture: Fixture): Promise<{
  bytes: Uint8Array
  key: CryptoKey
  aad: Uint8Array
}> {
  const kem = createNobleKem1024()
  const keys = kem.keygen(KEM_SEED)
  const sharedSecret = kem.decapsulate(fixture.envelope.kemCiphertext, keys.secretKey)
  const info = hkdfInfoV2(fixture.envelope.suite, fixture.envelope.recipientKemKeyId)
  const material = await crypto.subtle.importKey(
    "raw",
    toOwnedArrayBuffer(sharedSecret),
    "HKDF",
    false,
    ["deriveKey"],
  )
  const key = await crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toOwnedArrayBuffer(fixture.envelope.hkdfSalt),
      info: toOwnedArrayBuffer(info),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  )
  const aad = encodeMlKemAadV2({
    version: 2,
    type: "pq-message",
    suite: fixture.envelope.suite,
    recipientKemKeyId: fixture.envelope.recipientKemKeyId,
    kemCiphertextSha256: await sha256(fixture.envelope.kemCiphertext),
  })
  const bytes = new Uint8Array(
    await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: toOwnedArrayBuffer(fixture.envelope.iv),
        additionalData: toOwnedArrayBuffer(aad),
        tagLength: 128,
      },
      key,
      toOwnedArrayBuffer(fixture.envelope.ciphertext),
    ),
  )
  zeroize(keys.secretKey, sharedSecret, info)
  return { bytes, key, aad }
}

async function withInnerBytes(
  fixture: Fixture,
  bytes: Uint8Array,
): Promise<MlKemMessageEnvelopeV2> {
  const inner = await innerCrypto(fixture)
  try {
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        {
          name: "AES-GCM",
          iv: toOwnedArrayBuffer(fixture.envelope.iv),
          additionalData: toOwnedArrayBuffer(inner.aad),
          tagLength: 128,
        },
        inner.key,
        toOwnedArrayBuffer(bytes),
      ),
    )
    return { ...cloneEnvelope(fixture.envelope), ciphertext }
  } finally {
    zeroize(inner.bytes)
  }
}

afterEach(() => {
  vi.restoreAllMocks()
})

describe("signed composition golden", () => {
  it("freezes the complete envelope and every deterministic seam", async () => {
    const fixture = await compositionFixture()
    try {
      expect(bytesToHex(fixture.envelope.hkdfSalt)).toBe("a3".repeat(32))
      expect(bytesToHex(fixture.envelope.iv)).toBe("a4".repeat(12))
      expect(await sha256Hex(fixture.envelope.kemCiphertext)).toBe(
        "7e7cc499f2d0f3bb0bb7aa61a3705c83bfc5cf2446b6bc81a1aa4badd2ea25ae",
      )
      expect(await sha256Hex(encodeMlKemEnvelopeV2(fixture.envelope))).toBe(
        "5986a6b363df30bc95dfa668b03359315df88d3b7f67593dbe62bf61cc4b2f18",
      )
      const inner = await fixture.client.openPqEnvelope(recipient(fixture))
      if (inner.kind !== "signed") throw new Error("expected signed inner")
      const signed = decodeSignedMessageV2(inner.signedMessageBytes)
      expect(signed.body.messageId).toEqual(MESSAGE_ID)
      expect(signed.body.createdAt).toBe(CREATED_AT)
      expect(signed.body.plaintext).toEqual(fixture.plaintext)
      expect(await sha256Hex(signed.signature.value)).toBe(
        "e14ce55d6babde5635701fcf79566b8b064fc353ccbbdc7b8de50ade1385fcb2",
      )
    } finally {
      fixture.client.dispose()
    }
  })

  it("rejects all outer cryptographic field mutations", async () => {
    const fixture = await compositionFixture()
    try {
      const mutations: Array<(envelope: MlKemMessageEnvelopeV2) => void> = [
        (envelope) => {
          envelope.kemCiphertext[0] = envelope.kemCiphertext[0]! ^ 1
        },
        (envelope) => {
          envelope.hkdfSalt[0] = envelope.hkdfSalt[0]! ^ 1
        },
        (envelope) => {
          envelope.iv[0] = envelope.iv[0]! ^ 1
        },
        (envelope) => {
          const last = envelope.ciphertext.byteLength - 1
          envelope.ciphertext[last] = envelope.ciphertext[last]! ^ 1
        },
        (envelope) => {
          envelope.suite = "ML-KEM-1024+HKDF-SHA256+A256GCM"
        },
        (envelope) => {
          envelope.recipientKemKeyId = OTHER_KEY_ID
        },
      ]
      for (const mutate of mutations) {
        const tampered = cloneEnvelope(fixture.envelope)
        mutate(tampered)
        await expect(
          fixture.client.openPqEnvelope(recipient(fixture, tampered)),
        ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
      }
    } finally {
      fixture.client.dispose()
    }
  })

  it("shows implicit rejection returns a value but GCM still fails", async () => {
    const fixture = await compositionFixture()
    try {
      const kem = createNobleKem1024()
      const keys = kem.keygen(KEM_SEED)
      const valid = kem.decapsulate(fixture.envelope.kemCiphertext, keys.secretKey)
      const tamperedCiphertext = Uint8Array.from(fixture.envelope.kemCiphertext)
      tamperedCiphertext[0] = tamperedCiphertext[0]! ^ 1
      const rejected = kem.decapsulate(tamperedCiphertext, keys.secretKey)
      expect(rejected).toHaveLength(32)
      expect(bytesEqual(rejected, valid)).toBe(false)
      const tampered = cloneEnvelope(fixture.envelope)
      tampered.kemCiphertext = tamperedCiphertext
      await expect(
        fixture.client.openPqEnvelope(recipient(fixture, tampered)),
      ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
      zeroize(keys.secretKey, valid, rejected)
    } finally {
      fixture.client.dispose()
    }
  })

  it("rejects an authenticated but invalid inner schema", async () => {
    const fixture = await compositionFixture()
    try {
      const inner = await innerCrypto(fixture)
      const decoded = decodeCanonicalCbor(inner.bytes) as Record<string, unknown>
      const invalidValue = { ...decoded, unexpected: 1 }
      const invalidBytes = encodeCanonicalCbor(
        invalidValue as unknown as CanonicalCborValue,
      )
      const envelope = await withInnerBytes(fixture, invalidBytes)
      await expect(
        fixture.client.openPqEnvelope(recipient(fixture, envelope)),
      ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
      zeroize(inner.bytes, invalidBytes)
    } finally {
      fixture.client.dispose()
    }
  })

  it("maps an authenticated signature mutation to SIGNATURE_INVALID", async () => {
    const fixture = await compositionFixture()
    try {
      const inner = await innerCrypto(fixture)
      const signed = decodeSignedMessageV2(inner.bytes)
      signed.signature.value[0] = signed.signature.value[0]! ^ 1
      const tamperedInner = encodeSignedMessageV2(signed)
      const envelope = await withInnerBytes(fixture, tamperedInner)
      await expect(
        decryptPqMessage({
          client: fixture.client,
          envelope,
          recipient: fixture.identity,
          vaultKey: fixture.vaultKey,
          resolveSigningKey: async () => ({
            algorithm: "ML-DSA-87",
            publicKey: fixture.identity.signing.publicKey,
            revoked: false,
          }),
        }),
      ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" })
      zeroize(inner.bytes, signed.body.plaintext, signed.signature.value, tamperedInner)
    } finally {
      fixture.client.dispose()
    }
  })
})

it("withZeroize clears buffers on exceptional finally paths", async () => {
  const secret = new Uint8Array([1, 2, 3, 4])
  await expect(
    withZeroize([secret], async () => {
      throw new AppError("DECRYPTION_FAILED")
    }),
  ).rejects.toMatchObject({ code: "DECRYPTION_FAILED" })
  expect(secret).toEqual(new Uint8Array(4))
})
