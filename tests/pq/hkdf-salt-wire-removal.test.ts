import { describe, expect, expectTypeOf, it } from "vitest"
import { AppError } from "@/crypto/errors"
import {
  decodeMlKemEnvelopeV2,
  decodeSymMessageEnvelopeV2,
  encodeCanonicalCbor,
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
} from "@/crypto/pq/canonical-cbor"
import {
  validateMlKemEnvelopeV2,
  validateSymMessageEnvelopeV2,
} from "@/crypto/pq/validation"
import {
  MAX_SYM_PLAINTEXT_BYTES,
  SYM_MESSAGE_OVERHEAD_BYTES,
} from "@/lib/limits"
import type {
  MlKemMessageEnvelopeV2,
  SymMessageEnvelopeV2,
} from "@/schemas/domain"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const SUITE = "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"

const pqEnvelope = {
  version: 2,
  type: "pq-message",
  suite: SUITE,
  recipientKemKeyId: KEY_ID,
  kemCiphertext: new Uint8Array(1568),
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(16),
} as const

const symEnvelope = {
  version: 2,
  type: "sym-message",
  suite: "HKDF-SHA256+A256GCM",
  keyId: KEY_ID,
  createdAt: 1_700_000_000_000,
  iv: new Uint8Array(12),
  ciphertext: new Uint8Array(16),
} as const

function expectInvalidQrPayload(operation: () => unknown): void {
  let caught: unknown
  try {
    operation()
  } catch (error) {
    caught = error
  }

  expect(caught).toBeInstanceOf(AppError)
  expect(caught).toMatchObject({
    code: "INVALID_QR_PAYLOAD",
    message: "INVALID_QR_PAYLOAD",
  })
}

describe("hkdfSalt wire removal", () => {
  it("removes hkdfSalt from both active envelope types", () => {
    expectTypeOf<MlKemMessageEnvelopeV2>().toEqualTypeOf<
      Omit<MlKemMessageEnvelopeV2, "hkdfSalt">
    >()
    expectTypeOf<SymMessageEnvelopeV2>().toEqualTypeOf<
      Omit<SymMessageEnvelopeV2, "hkdfSalt">
    >()
  })

  it("validates, encodes, and decodes a saltless PQ envelope", () => {
    const validated = validateMlKemEnvelopeV2(pqEnvelope)
    const decoded = decodeMlKemEnvelopeV2(encodeMlKemEnvelopeV2(validated))

    expect(validated).toEqual(pqEnvelope)
    expect(decoded).toEqual(pqEnvelope)
    expect(Object.keys(decoded)).not.toContain("hkdfSalt")
  })

  it("validates, encodes, and decodes a saltless symmetric envelope", () => {
    const validated = validateSymMessageEnvelopeV2(symEnvelope)
    const decoded = decodeSymMessageEnvelopeV2(
      encodeSymMessageEnvelopeV2(validated),
    )

    expect(validated).toEqual(symEnvelope)
    expect(decoded).toEqual(symEnvelope)
    expect(Object.keys(decoded)).not.toContain("hkdfSalt")
  })

  it("rejects an old PQ envelope as a normal validation failure", () => {
    const oldEnvelope = { ...pqEnvelope, hkdfSalt: new Uint8Array(32) }

    expectInvalidQrPayload(() => validateMlKemEnvelopeV2(oldEnvelope))
    expectInvalidQrPayload(() => encodeMlKemEnvelopeV2(oldEnvelope))
    expectInvalidQrPayload(() =>
      decodeMlKemEnvelopeV2(encodeCanonicalCbor(oldEnvelope)),
    )
  })

  it("rejects an old symmetric envelope as a normal validation failure", () => {
    const oldEnvelope = { ...symEnvelope, hkdfSalt: new Uint8Array(32) }

    expectInvalidQrPayload(() => validateSymMessageEnvelopeV2(oldEnvelope))
    expectInvalidQrPayload(() => encodeSymMessageEnvelopeV2(oldEnvelope))
    expectInvalidQrPayload(() =>
      decodeSymMessageEnvelopeV2(encodeCanonicalCbor(oldEnvelope)),
    )
  })

  it("pins the saltless symmetric single-frame limits", () => {
    expect(SYM_MESSAGE_OVERHEAD_BYTES).toBe(131)
    expect(MAX_SYM_PLAINTEXT_BYTES).toBe(853)
  })
})
