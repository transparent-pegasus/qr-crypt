// Golden fixtures for v2 canonical CBOR.
// These hex values must match docs/spec/qr-protocol-v2.md §8.
// Changing a value requires a wire-protocol revision; do not update them casually.
import { describe, expect, it, vi } from "vitest"
import type { MlKemMessageEnvelopeV2, QrFrameV2 } from "@/schemas/domain"
import { AppError, type ErrorCode } from "@/crypto/errors"
import {
  decodeCanonicalCbor,
  decodeMlKemEnvelopeV2,
  decodePublicIdentityBundleV2,
  decodeQrFrameV2,
  decodeSignedMessageV2,
  encodeCanonicalCbor,
  encodeMlKemAadV2,
  encodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2,
  encodeQrFrameV2,
  signingTargetBytes,
} from "@/crypto/pq/canonical-cbor"
import { resolveSuite, suiteComponents } from "@/crypto/pq/suites"
import { bytesToHex, sha256Hex } from "@/lib/bytes"
import {
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  MAX_FRAME_PAYLOAD_CHARS,
} from "@/lib/limits"
import { qrByteCapacity } from "@/qr/encode"
import { WIRE_SUITES } from "@/schemas/domain"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw" // 22-character base64url for bytes 00..0f.

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2)
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16)
  }
  return out
}

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

function exactSizeCanonicalMap(
  targetByteLength: number,
  valueWithPayload: (
    payload: Uint8Array,
  ) => Parameters<typeof encodeCanonicalCbor>[0],
): Uint8Array {
  let low = 0
  let high = targetByteLength
  while (low <= high) {
    const payloadBytes = Math.floor((low + high) / 2)
    const encoded = encodeCanonicalCbor(
      valueWithPayload(new Uint8Array(payloadBytes)),
    )
    if (encoded.byteLength === targetByteLength) return encoded
    if (encoded.byteLength < targetByteLength) low = payloadBytes + 1
    else high = payloadBytes - 1
  }
  throw new Error(`cannot construct ${targetByteLength}-byte canonical map`)
}

// ---------------------------------------------------------------------------
// Golden values (frozen hex).
// ---------------------------------------------------------------------------

const AAD_GOLDEN_HEX =
  "a564747970656a70712d6d65737361676565737569746578294d4c2d4b454d2d313032342b4d4c2d4453412d38372b484b44462d5348413235362b4132353647434d6776657273696f6e0271726563697069656e744b656d4b657949647641414543417751464267634943516f4c4441304f4477736b656d4369706865727465787453686132353658202222222222222222222222222222222222222222222222222222222222222222"

const TINY_FRAME_GOLDEN_HEX =
  "a864747970656871722d6672616d65656368756e6b44aabbccdd6776657273696f6e026a66" +
  "72616d65436f756e74026a6672616d65496e646578006a7472616e73666572496450010101" +
  "010101010101010101010101016c6172746966616374547970656a70712d6d657373616765" +
  "6f746f74616c427974654c656e67746808"

const SIGNING_TARGET_GOLDEN_HEX =
  "a66776657273696f6e02696372656174656441741b0000018bcfe56800696d657373616765" +
  "4964500707070707070707070707070707070769706c61696e7465787444746573747172" +
  "6563697069656e744b656d4b657949647641414543417751464267634943516f4c4441304f" +
  "44777273656e6465725369676e696e674b657949647641414543417751464267634943516f" +
  "4c4441304f4477"

function fixtureEnvelope(): MlKemMessageEnvelopeV2 {
  return {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEY_ID,
    kemCiphertext: new Uint8Array(1568).fill(0x33),
    hkdfSalt: new Uint8Array(32).fill(0x44),
    iv: new Uint8Array(12).fill(0x55),
    ciphertext: new Uint8Array(20).fill(0x66),
  }
}

function fixtureFrame(): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16).fill(0x01),
    artifactType: "pq-message",
    frameIndex: 0,
    frameCount: 2,
    totalByteLength: 8,
    chunk: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
  }
}

describe("canonical-cbor goldens", () => {
  it("matches the frozen encoded bytes for MlKemAadV2", () => {
    const bytes = encodeMlKemAadV2({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: KEY_ID,
      kemCiphertextSha256: new Uint8Array(32).fill(0x22),
    })
    expect(bytesToHex(bytes)).toBe(AAD_GOLDEN_HEX)
  })

  it("encodes equivalent objects with different key insertion order identically", () => {
    const reordered = {
      kemCiphertextSha256: new Uint8Array(32).fill(0x22),
      recipientKemKeyId: KEY_ID,
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      version: 2,
      type: "pq-message",
    }
    expect(bytesToHex(encodeCanonicalCbor(reordered))).toBe(AAD_GOLDEN_HEX)
  })

  it("matches the frozen envelope encoding length and SHA-256", async () => {
    const bytes = encodeMlKemEnvelopeV2(fixtureEnvelope())
    expect(bytes.byteLength).toBe(1792)
    expect(await sha256Hex(bytes)).toBe(
      "d121c8ad34a2043f7c43f3c4b8cafedb974feaea3134040248a93a211acfee82",
    )
    // Also pin the first 48 bytes: map header a8 and iv/type/suite ordering.
    expect(bytesToHex(bytes.subarray(0, 48))).toBe(
      "a86269764c55555555555555555555555564747970656a70712d6d65737361676565737569746578294d4c2d4b454d2d",
    )
  })

  it("matches the frozen QrFrameV2 encoding and round-trips identically", () => {
    const bytes = encodeQrFrameV2(fixtureFrame())
    expect(bytesToHex(bytes)).toBe(TINY_FRAME_GOLDEN_HEX)
    expect(decodeQrFrameV2(bytes)).toEqual(fixtureFrame())
  })

  it("matches the frozen signing-target bytes for SignedMessageBodyV2", () => {
    const bytes = signingTargetBytes({
      version: 2,
      messageId: new Uint8Array(16).fill(0x07),
      createdAt: 1_700_000_000_000,
      recipientKemKeyId: KEY_ID,
      plaintext: new Uint8Array([0x74, 0x65, 0x73, 0x74]),
      senderSigningKeyId: KEY_ID,
    })
    // createdAt must be uint64 (1b …), not float64 (fb …).
    expect(bytesToHex(bytes)).toBe(SIGNING_TARGET_GOLDEN_HEX)
    expect(bytesToHex(bytes)).toContain("1b0000018bcfe56800")
  })

  it("matches the frozen PublicIdentityBundleV2 encoding length and SHA-256", async () => {
    const bytes = encodePublicIdentityBundleV2({
      version: 2,
      type: "pq-public-identity",
      identityId: KEY_ID,
      name: "テスト",
      kem: {
        algorithm: "ML-KEM-1024",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1568).fill(0x0a),
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId: KEY_ID,
        publicKey: new Uint8Array(2592).fill(0x0b),
      },
      createdAt: 1_700_000_000_000,
    })
    expect(bytes.byteLength).toBe(4402)
    expect(await sha256Hex(bytes)).toBe(
      "0d42425365c8f001bf846d158e46d2532bc20973cf1e431e4484f292e222c326",
    )
    expect(decodePublicIdentityBundleV2(bytes).name).toBe("テスト")
  })

  it("round-trips the envelope identically", () => {
    const envelope = fixtureEnvelope()
    expect(decodeMlKemEnvelopeV2(encodeMlKemEnvelopeV2(envelope))).toEqual(envelope)
  })
})

// ---------------------------------------------------------------------------
// Reject non-canonical and out-of-profile input.
// ---------------------------------------------------------------------------

describe("canonical-cbor rejections", () => {
  const rejects: [string, string][] = [
    ["duplicate key", "a2616101616102"],
    ["key-order violation", "a2616201616102"],
    ["indefinite-length map", "bf616101ff"],
    ["trailing data", "0101"],
    ["float64", "fb4000000000000000"],
    ["negative integer", "20"],
    ["tag", "c001"],
    ["array", "8101"],
    ["null", "f6"],
    ["non-minimal integer (23 encoded in two bytes)", "1817"],
    ["non-minimal length header (text length 3 encoded in two bytes)", "7803616263"],
    ["empty input", ""],
  ]
  for (const [label, hex] of rejects) {
    it(`decodeCanonicalCbor rejects ${label}`, () => {
      expectCode(() => decodeCanonicalCbor(hexToBytes(hex)), "INVALID_QR_PAYLOAD")
    })
  }

  it("rejects an envelope containing an unknown key", () => {
    const bytes = encodeCanonicalCbor({
      ...(fixtureEnvelope() as unknown as Record<string, never>),
      extra: 1,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeMlKemEnvelopeV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("rejects an envelope whose KEM ciphertext length disagrees with the suite", () => {
    const broken = { ...fixtureEnvelope(), kemCiphertext: new Uint8Array(10) }
    expectCode(() => encodeMlKemEnvelopeV2(broken), "INVALID_QR_PAYLOAD")
    const bytes = encodeCanonicalCbor(
      broken as unknown as Parameters<typeof encodeCanonicalCbor>[0],
    )
    expectCode(() => decodeMlKemEnvelopeV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("rejects a signed message with a missing signature", () => {
    const bytes = encodeCanonicalCbor({
      body: {
        version: 2,
        messageId: new Uint8Array(16),
        createdAt: 1,
        recipientKemKeyId: KEY_ID,
        plaintext: new Uint8Array([0x01]),
        senderSigningKeyId: KEY_ID,
      },
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeSignedMessageV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("rejects a mixed-profile 768+87 bundle", () => {
    const bytes = encodeCanonicalCbor({
      version: 2,
      type: "pq-public-identity",
      identityId: KEY_ID,
      kem: {
        algorithm: "ML-KEM-768",
        keyId: KEY_ID,
        publicKey: new Uint8Array(1184).fill(0x0a),
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId: KEY_ID,
        publicKey: new Uint8Array(2592).fill(0x0b),
      },
      createdAt: 1,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodePublicIdentityBundleV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("rejects a frame with frameIndex ≥ frameCount", () => {
    const bytes = encodeCanonicalCbor({
      ...(fixtureFrame() as unknown as Record<string, never>),
      frameIndex: 2,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeQrFrameV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("accepts canonical input at the absolute byte boundary and rejects one byte beyond", () => {
    const valueWithPayload = (payload: Uint8Array) => ({
      type: "pq-message",
      payload,
    })
    const atLimit = exactSizeCanonicalMap(
      MAX_ARTIFACT_BYTES_ABSOLUTE,
      valueWithPayload,
    )
    const beyondLimit = exactSizeCanonicalMap(
      MAX_ARTIFACT_BYTES_ABSOLUTE + 1,
      valueWithPayload,
    )

    expect(atLimit).toHaveLength(MAX_ARTIFACT_BYTES_ABSOLUTE)
    const decoded = decodeCanonicalCbor(atLimit) as Record<string, unknown>
    expect(decoded["type"]).toBe("pq-message")
    expect(decoded["payload"]).toBeInstanceOf(Uint8Array)
    expect((decoded["payload"] as Uint8Array).byteLength).toBeGreaterThan(0)
    expect(
      encodeCanonicalCbor(
        decoded as Parameters<typeof encodeCanonicalCbor>[0],
      ),
    ).toEqual(atLimit)
    expect(beyondLimit).toHaveLength(MAX_ARTIFACT_BYTES_ABSOLUTE + 1)
    expectCode(
      () => decodeCanonicalCbor(beyondLimit),
      "INVALID_QR_PAYLOAD",
    )
  })

  it("rejects a maximum-size canonical map with too many unique entries", () => {
    const manyUniqueEntries = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`k${index}`, index]),
    )
    const bytes = exactSizeCanonicalMap(
      MAX_ARTIFACT_BYTES_ABSOLUTE,
      (payload) =>
        ({
          ...manyUniqueEntries,
          payload,
        }) as Parameters<typeof encodeCanonicalCbor>[0],
    )

    expect(bytes).toHaveLength(MAX_ARTIFACT_BYTES_ABSOLUTE)
    expectCode(() => decodeCanonicalCbor(bytes), "INVALID_QR_PAYLOAD")
  })

  it("rejects aggregate map entries, oversized keys, and oversized text", () => {
    const nestedNineEntries = Object.fromEntries(
      Array.from({ length: 9 }, (_, index) => [`k${index}`, index]),
    )
    const aggregateFourteenEntries = encodeCanonicalCbor({
      a: 1,
      b: 2,
      c: 3,
      d: 4,
      nested: nestedNineEntries,
    })
    const oversizedKey = encodeCanonicalCbor({
      ["k".repeat(20)]: 1,
    })
    const oversizedText = encodeCanonicalCbor({
      a: "x".repeat(301),
    })

    for (const bytes of [
      aggregateFourteenEntries,
      oversizedKey,
      oversizedText,
    ]) {
      expectCode(() => decodeCanonicalCbor(bytes), "INVALID_QR_PAYLOAD")
    }
  })

  it("retains no attacker-selected key encoding across repeated decodes", () => {
    const attackerKeys = Array.from(
      { length: 24 },
      (_, index) => `k${String(index).padStart(17, "0")}`,
    )
    const submissions = attackerKeys.map((key, index) =>
      encodeCanonicalCbor({ [key]: index }),
    )
    const encodeSpy = vi.spyOn(TextEncoder.prototype, "encode")

    try {
      const firstRound = submissions.map((bytes) =>
        decodeCanonicalCbor(bytes),
      )
      const secondRound = submissions.map((bytes) =>
        decodeCanonicalCbor(bytes),
      )

      for (let index = 0; index < attackerKeys.length; index += 1) {
        expect(Object.getPrototypeOf(firstRound[index] as object)).toBeNull()
        expect(Object.getPrototypeOf(secondRound[index] as object)).toBeNull()
        expect(secondRound[index]).not.toBe(firstRound[index])
      }

      const attackerKeyEncodes = encodeSpy.mock.calls
        .map(([value]) => value)
        .filter(
          (value): value is string =>
            typeof value === "string" && attackerKeys.includes(value),
        )
      for (const key of attackerKeys) {
        expect(attackerKeyEncodes.filter((value) => value === key)).toHaveLength(
          2,
        )
      }
    } finally {
      encodeSpy.mockRestore()
    }
  })
})

// ---------------------------------------------------------------------------
// Suite contract and capacity consistency.
// ---------------------------------------------------------------------------

describe("suite contract", () => {
  it("round-trips resolveSuite and suiteComponents consistently", () => {
    for (const suite of WIRE_SUITES) {
      const components = suiteComponents(suite)
      expect(resolveSuite(components.kem, components.signature)).toBe(suite)
    }
  })

  it("rejects retired algorithm combinations", () => {
    expectCode(
      () => resolveSuite("ML-KEM-768" as never, "ML-DSA-87"),
      "UNSUPPORTED_ALGORITHM",
    )
    expectCode(
      () => resolveSuite("ML-KEM-1024", "ML-DSA-65" as never),
      "UNSUPPORTED_ALGORITHM",
    )
  })

  it("matches MAX_FRAME_PAYLOAD_CHARS to QR v40 EC-Q capacity", () => {
    expect(MAX_FRAME_PAYLOAD_CHARS).toBe(qrByteCapacity("Q"))
  })
})
