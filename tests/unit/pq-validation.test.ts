import { describe, expect, it, vi } from "vitest"
import { encryptPq } from "@/crypto/pq/ml-kem-envelope"
import { maxEnvelopeCiphertextBytes } from "@/crypto/pq/profiles"
import {
  decodeQrFrameV2,
  encodeCanonicalCbor,
} from "@/crypto/pq/canonical-cbor"
import {
  validateMlKemEnvelopeV2,
  validatePublicIdentityBundleV2,
  validateQrFrameV2,
} from "@/crypto/pq/validation"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  MAX_PQ_PLAINTEXT_BYTES,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import {
  V2_ARTIFACT_TYPES,
  type PqPublicBundleRecord,
  type QrFrameV2,
  type V2ArtifactType,
} from "@/schemas/domain"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const ACTIVE_SUITE = "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
const confirmedBundleFixture: PqPublicBundleRecord = {
  recordId: "recipient-record",
  identityId: "recipient-identity",
  name: "Recipient",
  kem: {
    algorithm: "ML-KEM-1024",
    keyId: KEY_ID,
    publicKey: new Uint8Array(1568),
    fingerprint: "kem-fingerprint",
  },
  signing: {
    algorithm: "ML-DSA-87",
    keyId: "EBESExQVFhcYGRobHB0eHw",
    publicKey: new Uint8Array(2592),
    fingerprint: "signing-fingerprint",
  },
  identityFingerprint: "identity-fingerprint",
  trust: "fingerprint-confirmed",
  trustConfirmedAt: 1_700_000_000_000,
  bundleCreatedAt: 1_699_999_999_999,
  importedAt: 1_700_000_000_000,
}

function validFrame(artifactType: V2ArtifactType = "pq-message"): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16),
    artifactType,
    frameIndex: 0,
    frameCount: 1,
    totalByteLength: 1,
    chunk: Uint8Array.of(1),
  }
}

function expectInvalidFrame(value: unknown): void {
  try {
    validateQrFrameV2(value)
    throw new Error("expected validation to fail")
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_QR_PAYLOAD" })
  }
}

describe("PQ strict validation", () => {
  it("layers the configured ciphertext bound over the canonical envelope guard", () => {
    const envelope = {
      version: 2,
      type: "pq-message",
      suite: ACTIVE_SUITE,
      recipientKemKeyId: KEY_ID,
      kemCiphertext: new Uint8Array(1568),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(16),
    } as const
    expect(validateMlKemEnvelopeV2(envelope)).toEqual(envelope)
    expect(() =>
      validateMlKemEnvelopeV2({
        ...envelope,
        ciphertext: new Uint8Array(maxEnvelopeCiphertextBytes(ACTIVE_SUITE) + 1),
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() => validateMlKemEnvelopeV2({ ...envelope, extra: true })).toThrow(
      "INVALID_QR_PAYLOAD",
    )
  })

  it("rejects a PQ plaintext one byte over its ceiling before Worker encryption", async () => {
    const encryptPqMessage = vi.fn()

    await expect(
      encryptPq({
        client: { encryptPqMessage } as never,
        recipient: {} as never,
        plaintext: new Uint8Array(MAX_PQ_PLAINTEXT_BYTES + 1),
        sign: {} as never,
        now: 1_700_000_000_000,
      }),
    ).rejects.toMatchObject({ code: "ENCRYPTION_FAILED" })
    expect(encryptPqMessage).not.toHaveBeenCalled()
  })

  it("refuses to encrypt to a bundle whose fingerprint was never confirmed", async () => {
    const encryptPqMessage = vi.fn()
    const unverifiedRecipient: PqPublicBundleRecord = {
      ...confirmedBundleFixture,
      trust: "unverified",
    }
    delete unverifiedRecipient.trustConfirmedAt

    await expect(
      encryptPq({
        client: { encryptPqMessage } as never,
        recipient: unverifiedRecipient,
        plaintext: new TextEncoder().encode("x"),
        sign: {} as never,
        now: 1_700_000_000_001,
      }),
    ).rejects.toMatchObject({ code: "KEY_NOT_FOUND" })
    expect(encryptPqMessage).not.toHaveBeenCalled()
  })

  it("accepts the active bundle and enforces exact public-key lengths", () => {
    const bundle = {
      version: 2,
      type: "pq-public-identity",
      identityId: KEY_ID,
      name: "検証",
      kem: {
        algorithm: "ML-KEM-1024",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1568),
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId: KEY_ID,
        publicKey: new Uint8Array(2592),
      },
      createdAt: 1_700_000_000_000,
    } as const
    expect(validatePublicIdentityBundleV2(bundle)).toEqual(bundle)
    expect(() =>
      validatePublicIdentityBundleV2({
        ...bundle,
        signing: {
          ...bundle.signing,
          publicKey: new Uint8Array(1952),
        },
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
  })

  // deviations.md records symmetric artifacts as single-frame only. That was
  // enforced at generation, so a compromised sender bypassed it simply by not
  // using the generator; the accepted chunk-length partition was then a covert
  // channel (T21). Rejection now happens on receive.
  it.each(["sym-message", "symmetric-key"] as const)(
    "rejects a multi-frame %s",
    (artifactType) => {
      expectInvalidFrame({
        ...validFrame(artifactType),
        frameCount: 2,
        totalByteLength: 2,
      })
    },
  )

  it.each(["pq-message", "pq-public-identity"] as const)(
    "still accepts a multi-frame %s",
    (artifactType) => {
      const frame = {
        ...validFrame(artifactType),
        frameCount: 2,
        totalByteLength: 2,
      }
      expect(validateQrFrameV2(frame)).toEqual(frame)
    },
  )

  it.each(V2_ARTIFACT_TYPES)("accepts the strict %s frame shape", (artifactType) => {
    expect(validateQrFrameV2(validFrame(artifactType))).toEqual(
      validFrame(artifactType),
    )
  })

  it("rejects unknown frame keys", () => {
    expectInvalidFrame({ ...validFrame(), extra: 1 })
  })

  it.each([
    ["short transferId", { transferId: new Uint8Array(15) }],
    ["zero frameCount", { frameCount: 0 }],
    ["index equal to count", { frameIndex: 1 }],
    ["zero total length", { totalByteLength: 0 }],
    ["empty chunk", { chunk: new Uint8Array() }],
    ["chunk beyond total", { chunk: Uint8Array.of(1, 2), totalByteLength: 1 }],
    ["fractional index", { frameIndex: 0.5 }],
    ["unsafe total", { totalByteLength: Number.MAX_SAFE_INTEGER + 1 }],
    ["unknown artifact type", { artifactType: "unknown" }],
  ] satisfies ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]>)(
    "rejects %s",
    (_name, changes) => {
      expectInvalidFrame({ ...validFrame(), ...changes })
    },
  )

  it("rejects non-plain frame object instances", () => {
    const value = Object.assign(
      Object.create({ inherited: true }) as object,
      validFrame(),
    )
    expectInvalidFrame(value)
  })

  it("rejects a legacy frame that still carries payloadSha256", () => {
    const legacy = encodeCanonicalCbor({
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: 4,
      payloadSha256: new Uint8Array(32),
      chunk: new Uint8Array([1, 2, 3, 4]),
    })
    expect(() => decodeQrFrameV2(legacy)).toThrowError(
      expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
    )
  })

  it("enforces independent per-frame and whole-artifact receiver bounds", () => {
    const frame = {
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: PROTOCOL_MAX_FRAMES - 1,
      frameCount: PROTOCOL_MAX_FRAMES,
      totalByteLength: MAX_ARTIFACT_BYTES_ABSOLUTE,
      chunk: new Uint8Array(FRAME_CHUNK_MAX_BYTES),
    } as const
    expect(validateQrFrameV2(frame)).toEqual(frame)

    expect(() =>
      validateQrFrameV2({
        ...frame,
        chunk: new Uint8Array(FRAME_CHUNK_MAX_BYTES + 1),
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() =>
      validateQrFrameV2({
        ...frame,
        totalByteLength: MAX_ARTIFACT_BYTES_ABSOLUTE + 1,
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() =>
      validateQrFrameV2({
        ...frame,
        frameCount: PROTOCOL_MAX_FRAMES + 1,
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
  })

  it("rejects frame metadata whose total cannot fit its declared frame count", () => {
    const frame = {
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 2,
      totalByteLength: FRAME_CHUNK_MAX_BYTES * 2 + 1,
      chunk: Uint8Array.of(1),
    } as const
    expect(() => validateQrFrameV2(frame)).toThrow("INVALID_QR_PAYLOAD")
  })

  it("rejects a single frame whose chunk length differs from its total", () => {
    expect(() =>
      validateQrFrameV2({
        ...validFrame(),
        totalByteLength: 2,
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
  })
})
