import { describe, expect, it } from "vitest"
import {
  validateMlKemEnvelopeV2,
  validatePublicIdentityBundleV2,
  validateQrFrameV2,
} from "@/crypto/pq/validation"
import { MAX_PLAINTEXT_BYTES } from "@/lib/limits"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"

describe("PQ strict validation", () => {
  it("layers the configured ciphertext bound over the canonical envelope guard", () => {
    const envelope = {
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
      recipientKemKeyId: KEY_ID,
      kemCiphertext: new Uint8Array(1088),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(16),
    } as const
    expect(validateMlKemEnvelopeV2(envelope)).toEqual(envelope)
    expect(() =>
      validateMlKemEnvelopeV2({
        ...envelope,
        ciphertext: new Uint8Array(MAX_PLAINTEXT_BYTES + 529),
      }),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() => validateMlKemEnvelopeV2({ ...envelope, extra: true })).toThrow(
      "INVALID_QR_PAYLOAD",
    )
  })

  it("rejects mixed bundle profiles and enforces exact public-key lengths", () => {
    const bundle = {
      version: 2,
      type: "pq-public-identity",
      identityId: KEY_ID,
      name: "検証",
      kem: {
        algorithm: "ML-KEM-768",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1184),
      },
      signing: {
        algorithm: "ML-DSA-65",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1952),
      },
      createdAt: 1_700_000_000_000,
    } as const
    expect(validatePublicIdentityBundleV2(bundle)).toEqual(bundle)
    expect(() =>
      validatePublicIdentityBundleV2({
        ...bundle,
        signing: {
          ...bundle.signing,
          algorithm: "ML-DSA-87",
          publicKey: new Uint8Array(2592),
        },
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
      totalByteLength: 1_801,
      payloadSha256: new Uint8Array(32),
      chunk: Uint8Array.of(1),
    } as const
    expect(() => validateQrFrameV2(frame)).toThrow("INVALID_QR_PAYLOAD")
  })
})
