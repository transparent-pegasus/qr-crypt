// Frozen sym-v2 wire fixtures. Changing these bytes requires a protocol revision.
import { describe, expect, it } from "vitest"
import type {
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
} from "@/schemas/domain"
import {
  decodeCanonicalCbor,
  decodeSymMessageEnvelopeV2,
  decodeSymmetricKeyEnvelopeV2,
  encodeSymAadV2,
  encodeSymMessageEnvelopeV2,
  encodeSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import {
  validateSymMessageEnvelopeV2,
  validateSymmetricKeyEnvelopeV2,
} from "@/crypto/pq/validation"
import { hkdfInfoSymV2 } from "@/crypto/pq/wire-bytes"
import { bytesToHex } from "@/lib/bytes"
import {
  AES_GCM_TAG_BYTES,
  AES_KEY_BYTES,
  FRAME_CHUNK_MAX_BYTES,
  HKDF_SALT_BYTES,
  IV_BYTES,
  MAX_SYM_PLAINTEXT_BYTES,
  SYM_MESSAGE_OVERHEAD_BYTES,
} from "@/lib/limits"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw" // base64url for raw bytes 00..0f.
const CREATED_AT = 1_700_000_000_000

// 1 map + iv 16 + type 17 + keyId 29 + suite 26 + version 9
// + hkdfSalt 43 + createdAt 19 + ciphertext 32 = 192 bytes.
const EXPECTED_ENVELOPE_HEX =
  "a86269764c222222222222222222222222" +
  "64747970656b73796d2d6d657373616765" +
  "656b657949647641414543417751464267634943516f4c4441304f4477" +
  "65737569746573484b44462d5348413235362b4132353647434d" +
  "6776657273696f6e02" +
  "68686b646653616c7458201111111111111111111111111111111111111111111111111111111111111111" +
  "696372656174656441741b0000018bcfe56800" +
  "6a63697068657274657874543333333333333333333333333333333333333333"

// 1 map + type 17 + keyId 29 + suite 26 + version 9 + createdAt 19 = 101 bytes.
const EXPECTED_AAD_HEX =
  "a564747970656b73796d2d6d657373616765" +
  "656b657949647641414543417751464267634943516f4c4441304f4477" +
  "65737569746573484b44462d5348413235362b4132353647434d" +
  "6776657273696f6e02" +
  "696372656174656441741b0000018bcfe56800"

// 23 label + 1 NUL + 19 suite + 1 NUL + 16 raw keyId + 1 version = 61 bytes.
const EXPECTED_INFO_HEX =
  "51522d43525950542d53594d2d4d4553534147452d563200" +
  "484b44462d5348413235362b4132353647434d00" +
  "000102030405060708090a0b0c0d0e0f02"

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2)
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return bytes
}

function expectInvalid(operation: () => unknown): void {
  expect(operation).toThrowError(
    expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
  )
}

function symMessageFixture(): SymMessageEnvelopeV2 {
  return {
    version: 2,
    type: "sym-message",
    suite: "HKDF-SHA256+A256GCM",
    keyId: KEY_ID,
    createdAt: CREATED_AT,
    hkdfSalt: new Uint8Array(32).fill(0x11),
    iv: new Uint8Array(12).fill(0x22),
    ciphertext: new Uint8Array(20).fill(0x33),
  }
}

function symmetricKeyFixture(): SymmetricKeyEnvelopeV2 {
  return {
    version: 2,
    type: "symmetric-key",
    algorithm: "A256GCM",
    keyId: KEY_ID,
    createdAt: CREATED_AT,
    key: new Uint8Array(32).fill(0x44),
  }
}

describe("sym-v2 canonical goldens", () => {
  it("matches the frozen sym-message envelope and round-trips canonically", () => {
    const envelope = symMessageFixture()
    const encoded = encodeSymMessageEnvelopeV2(envelope)

    expect(encoded).toHaveLength(192)
    expect(bytesToHex(encoded)).toBe(EXPECTED_ENVELOPE_HEX)
    const decoded = decodeSymMessageEnvelopeV2(encoded)
    expect(decoded).toEqual(envelope)
    expect(encodeSymMessageEnvelopeV2(decoded)).toEqual(encoded)
    expect(validateSymMessageEnvelopeV2(decoded)).toEqual(envelope)
  })

  it("round-trips the symmetric-key envelope canonically", () => {
    const envelope = symmetricKeyFixture()
    const encoded = encodeSymmetricKeyEnvelopeV2(envelope)
    const decoded = decodeSymmetricKeyEnvelopeV2(encoded)

    expect(decoded).toEqual(envelope)
    expect(encodeSymmetricKeyEnvelopeV2(decoded)).toEqual(encoded)
    expect(validateSymmetricKeyEnvelopeV2(decoded)).toEqual(envelope)
  })

  it("matches the frozen sym-message AAD", () => {
    const { version, type, suite, keyId, createdAt } = symMessageFixture()
    const encoded = encodeSymAadV2({ version, type, suite, keyId, createdAt })

    expect(encoded).toHaveLength(101)
    expect(bytesToHex(encoded)).toBe(EXPECTED_AAD_HEX)
  })

  it("matches the frozen sym-message HKDF info", () => {
    const info = hkdfInfoSymV2(KEY_ID)

    expect(info).toHaveLength(61)
    expect(bytesToHex(info)).toBe(EXPECTED_INFO_HEX)
  })
})

describe("sym-v2 canonical and schema rejections", () => {
  // The first two canonical pairs occupy 16 and 17 bytes after the map header.
  const ivPairEnd = 2 + 16 * 2
  const typePairEnd = ivPairEnd + 17 * 2
  const ivPair = EXPECTED_ENVELOPE_HEX.slice(2, ivPairEnd)
  const typePair = EXPECTED_ENVELOPE_HEX.slice(ivPairEnd, typePairEnd)
  const remainingPairs = EXPECTED_ENVELOPE_HEX.slice(typePairEnd)

  it.each([
    [
      "non-canonical key order",
      `a8${typePair}${ivPair}${remainingPairs}`,
    ],
    ["indefinite-length map", `bf${EXPECTED_ENVELOPE_HEX.slice(2)}ff`],
    ["trailing bytes", `${EXPECTED_ENVELOPE_HEX}00`],
  ])("rejects %s", (_name, hex) => {
    expectInvalid(() =>
      validateSymMessageEnvelopeV2(
        decodeSymMessageEnvelopeV2(hexToBytes(hex)),
      ),
    )
  })

  it("rejects a duplicate key before schema validation", () => {
    // {"a": 1, "a": 2}; two entries remain below the map-entry limit.
    expectInvalid(() => decodeCanonicalCbor(hexToBytes("a2616101616102")))
  })

  it("rejects unknown fields in both strict schemas", () => {
    expectInvalid(() =>
      validateSymMessageEnvelopeV2({ ...symMessageFixture(), extra: 1 }),
    )
    expectInvalid(() =>
      validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), extra: 1 }),
    )
  })

  it.each([
    ["sym-message version", () => validateSymMessageEnvelopeV2({ ...symMessageFixture(), version: 1 })],
    ["sym-message type", () => validateSymMessageEnvelopeV2({ ...symMessageFixture(), type: "pq-message" })],
    ["sym-message suite", () => validateSymMessageEnvelopeV2({ ...symMessageFixture(), suite: "HKDF-SHA512+A256GCM" })],
    ["sym-message keyId", () => validateSymMessageEnvelopeV2({ ...symMessageFixture(), keyId: "not-a-key-id" })],
    ["symmetric-key version", () => validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), version: 1 })],
    ["symmetric-key type", () => validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), type: "sym-message" })],
    ["symmetric-key algorithm", () => validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), algorithm: "AES-GCM" })],
    ["symmetric-key keyId", () => validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), keyId: "not-a-key-id" })],
  ])("rejects the wrong %s", (_name, operation) => {
    expectInvalid(operation)
  })

  it.each([
    ["short hkdfSalt", { hkdfSalt: new Uint8Array(HKDF_SALT_BYTES - 1) }],
    ["long hkdfSalt", { hkdfSalt: new Uint8Array(HKDF_SALT_BYTES + 1) }],
    ["short iv", { iv: new Uint8Array(IV_BYTES - 1) }],
    ["long iv", { iv: new Uint8Array(IV_BYTES + 1) }],
    ["ciphertext below the GCM tag", { ciphertext: new Uint8Array(AES_GCM_TAG_BYTES - 1) }],
    [
      "ciphertext above the plaintext ceiling",
      { ciphertext: new Uint8Array(MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES + 1) },
    ],
  ])("rejects %s", (_name, changes) => {
    expectInvalid(() =>
      validateSymMessageEnvelopeV2({ ...symMessageFixture(), ...changes }),
    )
  })

  it.each([
    ["short key", new Uint8Array(AES_KEY_BYTES - 1)],
    ["long key", new Uint8Array(AES_KEY_BYTES + 1)],
  ])("rejects a %s", (_name, key) => {
    expectInvalid(() =>
      validateSymmetricKeyEnvelopeV2({ ...symmetricKeyFixture(), key }),
    )
  })
})

describe("sym-message single-frame limit", () => {
  it("pins the exact envelope overhead and rejects one more plaintext byte", () => {
    // At this boundary ciphertext uses a three-byte CBOR byte-string header:
    // 1 map + 159 fixed field bytes + 11 ciphertext-key bytes + 3 header bytes = 174.
    expect(SYM_MESSAGE_OVERHEAD_BYTES).toBe(174)
    expect(MAX_SYM_PLAINTEXT_BYTES).toBe(810)
    expect(MAX_SYM_PLAINTEXT_BYTES).toBe(
      FRAME_CHUNK_MAX_BYTES - SYM_MESSAGE_OVERHEAD_BYTES - AES_GCM_TAG_BYTES,
    )

    const maximumEnvelope = {
      ...symMessageFixture(),
      ciphertext: new Uint8Array(
        MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES,
      ),
    }
    expect(validateSymMessageEnvelopeV2(maximumEnvelope)).toEqual(
      maximumEnvelope,
    )
    expect(encodeSymMessageEnvelopeV2(maximumEnvelope)).toHaveLength(
      FRAME_CHUNK_MAX_BYTES,
    )

    expectInvalid(() =>
      validateSymMessageEnvelopeV2({
        ...maximumEnvelope,
        ciphertext: new Uint8Array(
          MAX_SYM_PLAINTEXT_BYTES + AES_GCM_TAG_BYTES + 1,
        ),
      }),
    )
  })
})
