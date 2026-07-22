// v2 正準 CBOR のゴールデンフィクスチャ(plan2.1 §C9 — WP-A2 が凍結)。
// ここの hex 値は docs/qr-protocol-v2.md §8 と一致していなければならない。
// 値の変更はワイヤープロトコル改版を意味する — 安易に更新しないこと。
import { describe, expect, it } from "vitest"
import type { MlKemMessageEnvelopeV2, QrFrameV2 } from "@/schemas/domain"
import { AppError, type ErrorCode } from "@/crypto/errors"
import {
  decodeCanonicalCbor,
  decodeMlKemEnvelopeV2,
  decodePublicIdentityBundleV2,
  decodeQrFrameV2,
  decodeSignedMessageV2,
  decodeUnsignedMessageBodyV2,
  encodeCanonicalCbor,
  encodeMlKemAadV2,
  encodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2,
  encodeQrFrameV2,
  signingTargetBytes,
} from "@/crypto/pq/canonical-cbor"
import { resolveSuite, suiteComponents } from "@/crypto/pq/suites"
import { bytesToHex, sha256Hex } from "@/lib/bytes"
import { MAX_FRAME_PAYLOAD_CHARS } from "@/lib/limits"
import { qrByteCapacity } from "@/qr/encode"
import { WIRE_SUITES } from "@/schemas/domain"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw" // bytes 00..0f の base64url(22 文字)

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

// ---------------------------------------------------------------------------
// ゴールデン(hex 凍結)
// ---------------------------------------------------------------------------

const AAD_GOLDEN_HEX =
  "a564747970656a70712d6d657373616765657375697465781e4d4c2d4b454d2d3736382b" +
  "484b44462d5348413235362b4132353647434d6776657273696f6e0271726563697069656e" +
  "744b656d4b657949647641414543417751464267634943516f4c4441304f4477736b656d43" +
  "69706865727465787453686132353658202222222222222222222222222222222222222222" +
  "222222222222222222222222"

const TINY_FRAME_GOLDEN_HEX =
  "a964747970656871722d6672616d65656368756e6b44aabbccdd6776657273696f6e026a66" +
  "72616d65436f756e74026a6672616d65496e646578006a7472616e73666572496450010101" +
  "010101010101010101010101016c6172746966616374547970656a70712d6d657373616765" +
  "6d7061796c6f61645368613235365820020202020202020202020202020202020202020202" +
  "02020202020202020202026f746f74616c427974654c656e67746808"

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
    suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEY_ID,
    kemCiphertext: new Uint8Array(1088).fill(0x33),
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
    payloadSha256: new Uint8Array(32).fill(0x02),
    chunk: new Uint8Array([0xaa, 0xbb, 0xcc, 0xdd]),
  }
}

describe("canonical-cbor goldens", () => {
  it("MlKemAadV2 の符号化バイト列は凍結値と一致する", () => {
    const bytes = encodeMlKemAadV2({
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
      recipientKemKeyId: KEY_ID,
      kemCiphertextSha256: new Uint8Array(32).fill(0x22),
    })
    expect(bytesToHex(bytes)).toBe(AAD_GOLDEN_HEX)
  })

  it("キー挿入順が異なる同値オブジェクトは同一バイト列になる", () => {
    const reordered = {
      kemCiphertextSha256: new Uint8Array(32).fill(0x22),
      recipientKemKeyId: KEY_ID,
      suite: "ML-KEM-768+HKDF-SHA256+A256GCM",
      version: 2,
      type: "pq-message",
    }
    expect(bytesToHex(encodeCanonicalCbor(reordered))).toBe(AAD_GOLDEN_HEX)
  })

  it("エンベロープの符号化(長さ・SHA-256)は凍結値と一致する", async () => {
    const bytes = encodeMlKemEnvelopeV2(fixtureEnvelope())
    expect(bytes.byteLength).toBe(1301)
    expect(await sha256Hex(bytes)).toBe(
      "53b5af7642d5394156ef4eacfac829181a682e067d9c1fbc8297206117cea924",
    )
    // 先頭 96 バイト(map ヘッダー a8 と iv/type/suite の並び)も固定する
    expect(bytesToHex(bytes.subarray(0, 48))).toBe(
      "a86269764c55555555555555555555555564747970656a70712d6d657373616765657375" +
        "697465781e4d4c2d4b454d2d",
    )
  })

  it("QrFrameV2 の符号化は凍結値と一致し、往復で同値になる", () => {
    const bytes = encodeQrFrameV2(fixtureFrame())
    expect(bytesToHex(bytes)).toBe(TINY_FRAME_GOLDEN_HEX)
    expect(decodeQrFrameV2(bytes)).toEqual(fixtureFrame())
  })

  it("署名対象バイト列(SignedMessageBodyV2)は凍結値と一致する", () => {
    const bytes = signingTargetBytes({
      version: 2,
      messageId: new Uint8Array(16).fill(0x07),
      createdAt: 1_700_000_000_000,
      recipientKemKeyId: KEY_ID,
      plaintext: new Uint8Array([0x74, 0x65, 0x73, 0x74]),
      senderSigningKeyId: KEY_ID,
    })
    // createdAt は uint64(1b …)であり float64(fb …)ではないこと
    expect(bytesToHex(bytes)).toBe(SIGNING_TARGET_GOLDEN_HEX)
    expect(bytesToHex(bytes)).toContain("1b0000018bcfe56800")
  })

  it("PublicIdentityBundleV2 の符号化(長さ・SHA-256)は凍結値と一致する", async () => {
    const bytes = encodePublicIdentityBundleV2({
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
    })
    expect(bytes.byteLength).toBe(3377)
    expect(await sha256Hex(bytes)).toBe(
      "db7231d753096cc2847e87767040772ca7daef5f726104549d75f1359429925c",
    )
    expect(decodePublicIdentityBundleV2(bytes).name).toBe("テスト")
  })

  it("エンベロープと unsigned body は往復で同値になる", () => {
    const envelope = fixtureEnvelope()
    expect(decodeMlKemEnvelopeV2(encodeMlKemEnvelopeV2(envelope))).toEqual(envelope)
    const body = {
      version: 2 as const,
      messageId: new Uint8Array(16).fill(0x07),
      createdAt: 1_700_000_000_000,
      recipientKemKeyId: KEY_ID,
      plaintext: new Uint8Array([0x01]),
    }
    expect(
      decodeUnsignedMessageBodyV2(
        encodeCanonicalCbor(body as unknown as Parameters<typeof encodeCanonicalCbor>[0]),
      ),
    ).toEqual(body)
  })
})

// ---------------------------------------------------------------------------
// 非正準・プロファイル外入力の拒否
// ---------------------------------------------------------------------------

describe("canonical-cbor rejections", () => {
  const rejects: [string, string][] = [
    ["重複キー", "a2616101616102"],
    ["キー順違反", "a2616201616102"],
    ["不定長 map", "bf616101ff"],
    ["後続データ", "0101"],
    ["float64", "fb4000000000000000"],
    ["負数", "20"],
    ["タグ", "c001"],
    ["配列", "8101"],
    ["null", "f6"],
    ["非最小整数(23 を 2 バイト表現)", "1817"],
    ["非最小長さヘッダー(text 長 3 を 2 バイト表現)", "7803616263"],
    ["空入力", ""],
  ]
  for (const [label, hex] of rejects) {
    it(`decodeCanonicalCbor は ${label} を拒否する`, () => {
      expectCode(() => decodeCanonicalCbor(hexToBytes(hex)), "INVALID_QR_PAYLOAD")
    })
  }

  it("未知キーを含むエンベロープを拒否する", () => {
    const bytes = encodeCanonicalCbor({
      ...(fixtureEnvelope() as unknown as Record<string, never>),
      extra: 1,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeMlKemEnvelopeV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("KEM 暗号文長が suite と不一致のエンベロープを拒否する", () => {
    const broken = { ...fixtureEnvelope(), kemCiphertext: new Uint8Array(10) }
    expectCode(() => encodeMlKemEnvelopeV2(broken), "INVALID_QR_PAYLOAD")
    const bytes = encodeCanonicalCbor(
      broken as unknown as Parameters<typeof encodeCanonicalCbor>[0],
    )
    expectCode(() => decodeMlKemEnvelopeV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("unsigned body に senderSigningKeyId が載っていたら拒否する", () => {
    const bytes = encodeCanonicalCbor({
      version: 2,
      messageId: new Uint8Array(16),
      createdAt: 1,
      recipientKemKeyId: KEY_ID,
      plaintext: new Uint8Array([0x01]),
      senderSigningKeyId: KEY_ID,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeUnsignedMessageBodyV2(bytes), "INVALID_QR_PAYLOAD")
  })

  it("signed message の signature 欠落を拒否する", () => {
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

  it("プロファイル混在(768+87)の bundle を拒否する", () => {
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

  it("frameIndex ≥ frameCount のフレームを拒否する", () => {
    const bytes = encodeCanonicalCbor({
      ...(fixtureFrame() as unknown as Record<string, never>),
      frameIndex: 2,
    } as unknown as Parameters<typeof encodeCanonicalCbor>[0])
    expectCode(() => decodeQrFrameV2(bytes), "INVALID_QR_PAYLOAD")
  })
})

// ---------------------------------------------------------------------------
// suite 契約と容量整合
// ---------------------------------------------------------------------------

describe("suite contract", () => {
  it("resolveSuite と suiteComponents は往復一致する", () => {
    for (const suite of WIRE_SUITES) {
      const components = suiteComponents(suite)
      expect(resolveSuite(components.kem, components.signature)).toBe(suite)
    }
  })

  it("プロファイル混在の組は拒否する(plan2.1 §C1)", () => {
    expectCode(() => resolveSuite("ML-KEM-768", "ML-DSA-87"), "UNSUPPORTED_ALGORITHM")
    expectCode(() => resolveSuite("ML-KEM-1024", "ML-DSA-65"), "UNSUPPORTED_ALGORITHM")
  })

  it("MAX_FRAME_PAYLOAD_CHARS は QR v40 EC-Q の容量と一致する", () => {
    expect(MAX_FRAME_PAYLOAD_CHARS).toBe(qrByteCapacity("Q"))
  })
})
