// Golden fixtures for v2 byte conventions.
// Hex values must match docs/qr-protocol-v2.md §8.
import { describe, expect, it } from "vitest"
import type { PublicIdentityBundleV2 } from "@/schemas/domain"
import { AppError, type ErrorCode } from "@/crypto/errors"
import {
  buildVaultAadV2,
  hkdfInfoV2,
  keyIdRawBytes,
  mlDsaContextV2,
  pqIdentityFingerprint,
  pqKeyFingerprint,
} from "@/crypto/pq/wire-bytes"
import { encodeFrameToPayload, decodeFramePayload, QR_PREFIX_V2, classifyV2Payload, splitV2Payload } from "@/qr/payload-v2"
import { bytesToHex } from "@/lib/bytes"
import { MAX_FRAME_PAYLOAD_CHARS } from "@/lib/limits"
import { payloadFits } from "@/qr/encode"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"

function expectCode(fn: () => unknown, code: ErrorCode): void {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(AppError)
    expect((error as AppError).code).toBe(code)
    return
  }
  expect.unreachable("expected AppError " + code)
}

describe("hkdfInfoV2", () => {
  it("matches the frozen info bytes for unsigned 768", () => {
    expect(bytesToHex(hkdfInfoV2("ML-KEM-768+HKDF-SHA256+A256GCM", KEY_ID))).toBe(
      "51525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b484b44462d534841" +
        "3235362b4132353647434d00000102030405060708090a0b0c0d0e0f02",
    )
  })

  it("matches the frozen info bytes for signed 768", () => {
    expect(
      bytesToHex(hkdfInfoV2("ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM", KEY_ID)),
    ).toBe(
      "51525950542d4d4553534147452d5632004d4c2d4b454d2d3736382b4d4c2d4453412d36" +
        "352b484b44462d5348413235362b4132353647434d0000010203040506070809" +
        "0a0b0c0d0e0f02",
    )
  })

  it("accepts only a 22-character base64url keyId encoding 16 raw bytes", () => {
    expect(bytesToHex(keyIdRawBytes(KEY_ID))).toBe("000102030405060708090a0b0c0d0e0f")
    expectCode(() => keyIdRawBytes("AAAA"), "INVALID_QR_PAYLOAD")
    expectCode(() => keyIdRawBytes("AAECAwQFBgcICQoLDA0OD+"), "INVALID_QR_PAYLOAD")
  })
})

describe("mlDsaContextV2", () => {
  it("fixes the context to UTF8(QRYPT-MESSAGE-V2) at no more than 255B", () => {
    const context = mlDsaContextV2()
    expect(bytesToHex(context)).toBe("51525950542d4d4553534147452d5632")
    expect(context.byteLength).toBeLessThanOrEqual(255)
  })
})

describe("buildVaultAadV2", () => {
  it("matches the frozen AAD bytes", () => {
    const aad = buildVaultAadV2({
      identityId: KEY_ID,
      role: "ml-kem-seed",
      algorithm: "ML-KEM-768",
      keyId: KEY_ID,
      publicKeySha256: new Uint8Array(32).fill(0x11),
    })
    expect(bytesToHex(aad)).toBe(
      "a764726f6c656b6d6c2d6b656d2d7365656464747970656f71727970742d7661756c742d" +
        "616164656b657949647641414543417751464267634943516f4c4441304f4477677665727369" +
        "6f6e0269616c676f726974686d6a4d4c2d4b454d2d3736386a6964656e74697479496476" +
        "41414543417751464267634943516f4c4441304f44776f7075626c69634b65795368613235" +
        "3658201111111111111111111111111111111111111111111111111111111111111111",
    )
  })

  it("fails closed on a role/algorithm mismatch to detect seed substitution", () => {
    expectCode(
      () =>
        buildVaultAadV2({
          identityId: KEY_ID,
          role: "ml-kem-seed",
          algorithm: "ML-DSA-65",
          keyId: KEY_ID,
          publicKeySha256: new Uint8Array(32),
        }),
      "ENCRYPTION_FAILED",
    )
    expectCode(
      () =>
        buildVaultAadV2({
          identityId: KEY_ID,
          role: "ml-dsa-seed",
          algorithm: "ML-KEM-768",
          keyId: KEY_ID,
          publicKeySha256: new Uint8Array(32),
        }),
      "ENCRYPTION_FAILED",
    )
  })
})

describe("pq fingerprints", () => {
  it("matches the domain-separated frozen fingerprint for an individual key", async () => {
    expect(
      await pqKeyFingerprint("kem", "ML-KEM-768", new Uint8Array(1184).fill(0x0a)),
    ).toBe("86cca89b088994ddd47493b21d6c2ff3e3d44621ab842d289ca92325b1425dc9")
  })

  it("fingerprints the identity tuple without name and is independent of name", async () => {
    const bundle: PublicIdentityBundleV2 = {
      version: 2,
      type: "pq-public-identity",
      identityId: KEY_ID,
      name: "テスト",
      kem: {
        algorithm: "ML-KEM-768",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1184).fill(0x0a),
      },
      signing: {
        algorithm: "ML-DSA-65",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1952).fill(0x0b),
      },
      createdAt: 1_700_000_000_000,
    }
    const expected =
      "803025820e019d89098a95ec449fb59aa6f0232c856d036172425e81a2716122"
    expect(await pqIdentityFingerprint(bundle)).toBe(expected)
    const renamed = { ...bundle, name: "別名" }
    expect(await pqIdentityFingerprint(renamed)).toBe(expected)
    const anonymous = { ...bundle }
    delete anonymous.name
    expect(await pqIdentityFingerprint(anonymous)).toBe(expected)
  })
})

describe("payload-v2 frame codec", () => {
  it("round-trips OCF2 frames and fits them within EC-Q", () => {
    const frame = {
      version: 2 as const,
      type: "qr-frame" as const,
      transferId: new Uint8Array(16).fill(0x01),
      artifactType: "pq-message" as const,
      frameIndex: 1,
      frameCount: 2,
      totalByteLength: 1800,
      payloadSha256: new Uint8Array(32).fill(0x02),
      chunk: new Uint8Array(900).fill(0x03), // Maximum protocol chunk.
    }
    const payload = encodeFrameToPayload(frame)
    expect(payload.startsWith(QR_PREFIX_V2.frame)).toBe(true)
    expect(payload.length).toBeLessThanOrEqual(MAX_FRAME_PAYLOAD_CHARS)
    expect(payloadFits(payload, "Q")).toBe(true)
    expect(decodeFramePayload(payload)).toEqual(frame)
  })

  it("classifies only v2 prefixes and returns null for v1", () => {
    expect(classifyV2Payload("OCF2:xxxx")?.kind).toBe("frame")
    expect(classifyV2Payload("OCM2:xxxx")?.kind).toBe("pq-message")
    expect(classifyV2Payload("OCI2:xxxx")?.kind).toBe("pq-public-identity")
    expect(classifyV2Payload("OCM1:xxxx")).toBeNull()
    expect(classifyV2Payload("plain")).toBeNull()
  })

  it("rejects both generation and acceptance of reserved OCB2", () => {
    expectCode(() => splitV2Payload("OCB2:AAAA"), "UNSUPPORTED_ALGORITHM")
    expectCode(
      () => splitV2Payload("OCB2:"),
      "UNSUPPORTED_ALGORITHM",
    )
  })

  it("rejects non-frame input passed to decodeFramePayload", () => {
    expectCode(() => decodeFramePayload("OCM2:AAAA"), "INVALID_QR_PREFIX")
    expectCode(() => decodeFramePayload("OCF2:"), "INVALID_QR_PAYLOAD")
    expectCode(() => decodeFramePayload("OCF2:!!!"), "INVALID_QR_PAYLOAD")
  })
})
