import { describe, expect, it } from "vitest"
import {
  createNobleDsa65,
  createNobleDsa87,
  createNobleKem768,
  createNobleKem1024,
} from "@/crypto/pq/provider-noble"
import { signBody, verifySignedBody } from "@/crypto/pq/ml-dsa-signature"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import { mlDsaContextV2 } from "@/crypto/pq/wire-bytes"
import { bytesEqual } from "@/lib/bytes"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"

describe.each([
  ["ML-KEM-768", createNobleKem768],
  ["ML-KEM-1024", createNobleKem1024],
] as const)("%s provider", (algorithm, createProvider) => {
  const sizes = KEM_SIZES[algorithm]

  it("has frozen lengths and deterministic seed keygen", () => {
    const provider = createProvider()
    const seed = new Uint8Array(sizes.seedBytes).fill(0x31)
    const first = provider.keygen(seed)
    const second = provider.keygen(seed)
    expect(first.publicKey).toHaveLength(sizes.publicKeyBytes)
    expect(first.secretKey).toHaveLength(sizes.secretKeyBytes)
    expect(second).toEqual(first)

    const other = provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x32))
    expect(bytesEqual(other.publicKey, first.publicKey)).toBe(false)
  })

  it("returns adapter output lengths and decapsulates with the seeded key", () => {
    const provider = createProvider()
    const recipient = provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x41))
    const encapsulated = provider.encapsulate(recipient.publicKey)
    expect(encapsulated.ciphertext).toHaveLength(sizes.ciphertextBytes)
    expect(encapsulated.sharedSecret).toHaveLength(sizes.sharedSecretBytes)
    expect(provider.decapsulate(encapsulated.ciphertext, recipient.secretKey)).toEqual(
      encapsulated.sharedSecret,
    )
  })

  it("rejects every wrong input length before noble", () => {
    const provider = createProvider()
    expect(() => provider.keygen(new Uint8Array(sizes.seedBytes - 1))).toThrow(RangeError)
    expect(() => provider.encapsulate(new Uint8Array(sizes.publicKeyBytes - 1))).toThrow(
      RangeError,
    )
    expect(() =>
      provider.decapsulate(
        new Uint8Array(sizes.ciphertextBytes - 1),
        new Uint8Array(sizes.secretKeyBytes),
      ),
    ).toThrow(RangeError)
  })
})

describe.each([
  ["ML-DSA-65", createNobleDsa65],
  ["ML-DSA-87", createNobleDsa87],
] as const)("%s provider", (algorithm, createProvider) => {
  const sizes = DSA_SIZES[algorithm]

  it("has frozen lengths and deterministic seed keygen", () => {
    const provider = createProvider()
    const seed = new Uint8Array(sizes.seedBytes).fill(0x61)
    const first = provider.keygen(seed)
    const second = provider.keygen(seed)
    expect(first.publicKey).toHaveLength(sizes.publicKeyBytes)
    expect(first.secretKey).toHaveLength(sizes.secretKeyBytes)
    expect(second).toEqual(first)
    expect(
      bytesEqual(
        provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x62)).publicKey,
        first.publicKey,
      ),
    ).toBe(false)
  })

  it("round-trips randomized signatures and rejects bit/key/context changes", () => {
    const provider = createProvider()
    const keys = provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x71))
    const other = provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x72))
    const message = new TextEncoder().encode("pq signature provider test")
    const context = mlDsaContextV2()
    const first = provider.sign(message, keys.secretKey, context)
    const second = provider.sign(message, keys.secretKey, context)
    expect(first).toHaveLength(sizes.signatureBytes)
    expect(second).toHaveLength(sizes.signatureBytes)
    expect(bytesEqual(first, second)).toBe(false)
    expect(provider.verify(first, message, keys.publicKey, context)).toBe(true)
    expect(provider.verify(second, message, keys.publicKey, context)).toBe(true)

    const tampered = Uint8Array.from(first)
    const tamperedIndex = Math.floor(tampered.byteLength / 2)
    tampered[tamperedIndex] = tampered[tamperedIndex]! ^ 1
    expect(provider.verify(tampered, message, keys.publicKey, context)).toBe(false)
    expect(provider.verify(first, message, other.publicKey, context)).toBe(false)
    expect(provider.verify(first, message, keys.publicKey, new Uint8Array([0x01]))).toBe(
      false,
    )
  })

  it("signBody signs canonical body bytes with the fixed v2 context", () => {
    const provider = createProvider()
    const keys = provider.keygen(new Uint8Array(sizes.seedBytes).fill(0x73))
    const body = {
      version: 2 as const,
      messageId: new Uint8Array(16).fill(0x01),
      createdAt: 1_700_000_000_000,
      recipientKemKeyId: KEY_ID,
      plaintext: new TextEncoder().encode("signed body"),
      senderSigningKeyId: KEY_ID,
    }
    const signature = signBody({ provider, body, secretKey: keys.secretKey })
    expect(signature.algorithm).toBe(algorithm)
    expect(signature.value).toHaveLength(sizes.signatureBytes)
    expect(
      verifySignedBody({
        provider,
        body,
        signature,
        senderPublicKey: keys.publicKey,
      }),
    ).toBe(true)
    body.plaintext[0] = body.plaintext[0]! ^ 1
    expect(
      verifySignedBody({
        provider,
        body,
        signature,
        senderPublicKey: keys.publicKey,
      }),
    ).toBe(false)
  })

  it("rejects wrong seed, key, signature, and context lengths", () => {
    const provider = createProvider()
    const message = new Uint8Array([1])
    expect(() => provider.keygen(new Uint8Array(sizes.seedBytes + 1))).toThrow(RangeError)
    expect(() =>
      provider.sign(message, new Uint8Array(sizes.secretKeyBytes - 1), new Uint8Array()),
    ).toThrow(RangeError)
    expect(() =>
      provider.verify(
        new Uint8Array(sizes.signatureBytes - 1),
        message,
        new Uint8Array(sizes.publicKeyBytes),
        new Uint8Array(),
      ),
    ).toThrow(RangeError)
    expect(() =>
      provider.verify(
        new Uint8Array(sizes.signatureBytes),
        message,
        new Uint8Array(sizes.publicKeyBytes),
        new Uint8Array(256),
      ),
    ).toThrow(RangeError)
  })
})

it("keeps KEM and DSA seed lengths distinct", () => {
  const kemSeed = new Uint8Array(KEM_SIZES["ML-KEM-768"].seedBytes).fill(0x91)
  const dsaSeed = new Uint8Array(DSA_SIZES["ML-DSA-65"].seedBytes).fill(0x91)
  expect(kemSeed.byteLength).toBe(64)
  expect(dsaSeed.byteLength).toBe(32)
})
