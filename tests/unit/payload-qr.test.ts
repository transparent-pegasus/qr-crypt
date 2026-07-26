import { describe, expect, it } from "vitest"
import { Encoder, Tag } from "cbor-x"
import { PNG } from "pngjs"
import * as QRCode from "qrcode"
import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"
import { buildAad, type AnyEnvelopeV1 } from "@/crypto/envelope"
import { toBase64Url } from "@/lib/base64url"
import { concatBytes } from "@/lib/bytes"
import {
  MAX_CIPHERTEXT_BYTES,
  MAX_SYMMETRIC_PLAINTEXT_BYTES,
} from "@/lib/limits"
import {
  ecLevelFor,
  estimatePayloadChars,
  payloadFits,
  qrByteCapacity,
  renderQrDataUrl,
  renderQrSvgString,
} from "@/qr/encode"
import { buildExportFileName, qrSvgBlob, sanitizeQrFileName } from "@/qr/export-image"
import { decodePayload, encodeEnvelopeToPayload, payloadSha256Hex } from "@/qr/payload"

const KEY_ID = "B".repeat(22)
const CREATED_AT = 1_700_000_000_000
const rawEncoder = new Encoder({ useRecords: false, tagUint8Array: false })

function aesEnvelope(plaintextBytes = 12): AnyEnvelopeV1 {
  const aad = buildAad({
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId: KEY_ID,
    createdAt: CREATED_AT,
  })
  return {
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId: KEY_ID,
    createdAt: CREATED_AT,
    iv: new Uint8Array(12),
    ciphertext: new Uint8Array(plaintextBytes + 16),
    aad,
  }
}

const symmetricEnvelope: AnyEnvelopeV1 = {
  v: 1,
  type: "symmetric-key",
  algorithm: "A256GCM",
  keyId: KEY_ID,
  createdAt: CREATED_AT,
  key: new Uint8Array(32),
}

const publicEnvelope: AnyEnvelopeV1 = {
  v: 1,
  type: "public-key",
  algorithm: "RSA-OAEP-3072",
  keyId: KEY_ID,
  createdAt: CREATED_AT,
  spki: new Uint8Array(422),
}

function rawPayload(prefix: string, value: unknown): string {
  return `${prefix}${toBase64Url(rawEncoder.encode(value))}`
}

function decodePixels(
  luminance: Uint8ClampedArray,
  width: number,
  height: number,
): string {
  const source = new RGBLuminanceSource(luminance, width, height)
  const bitmap = new BinaryBitmap(new HybridBinarizer(source))
  return new QRCodeReader().decode(bitmap).getText()
}

function decodeModules(payload: string): string {
  const generated = QRCode.create(payload, { errorCorrectionLevel: "H" })
  const quiet = 4
  const scale = 4
  const width = (generated.modules.size + quiet * 2) * scale
  const pixels = new Uint8ClampedArray(width * width).fill(255)
  for (let row = 0; row < generated.modules.size; row += 1) {
    for (let column = 0; column < generated.modules.size; column += 1) {
      if (generated.modules.get(row, column) === 0) continue
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const targetY = (row + quiet) * scale + y
          const targetX = (column + quiet) * scale + x
          pixels[targetY * width + targetX] = 0
        }
      }
    }
  }
  return decodePixels(pixels, width, width)
}

async function decodePng(payload: string): Promise<string> {
  const buffer = await QRCode.toBuffer(payload, {
    errorCorrectionLevel: "H",
    margin: 4,
    scale: 4,
    color: { dark: "#000000", light: "#FFFFFFFF" },
  })
  const png = PNG.sync.read(buffer)
  const luminance = new Uint8ClampedArray(png.width * png.height)
  for (let index = 0; index < luminance.length; index += 1) {
    luminance[index] = png.data[index * 4]!
  }
  return decodePixels(luminance, png.width, png.height)
}

describe("deterministic payload encoding and strict decoding", () => {
  it("round-trips active v1 payloads", () => {
    for (const envelope of [aesEnvelope(), symmetricEnvelope, publicEnvelope]) {
      const payload = encodeEnvelopeToPayload(envelope)
      const decoded = decodePayload(payload)
      expect(decoded.envelope).toEqual(envelope)
    }
  })

  it("normalizes property insertion order to a byte-identical payload", () => {
    const original = aesEnvelope() as Extract<
      AnyEnvelopeV1,
      { algorithm: "A256GCM"; type: "message" }
    >
    const reordered = {
      aad: original.aad,
      ciphertext: original.ciphertext,
      iv: original.iv,
      createdAt: original.createdAt,
      keyId: original.keyId,
      algorithm: original.algorithm,
      type: original.type,
      v: original.v,
    } as AnyEnvelopeV1
    expect(encodeEnvelopeToPayload(reordered)).toBe(encodeEnvelopeToPayload(original))
  })

  it("follows prefix/version/type/algorithm/strict validation error mapping", () => {
    expect(() => decodePayload("XYZ1:abc")).toThrow("INVALID_QR_PREFIX")
    expect(() => decodePayload("OCB1:AA")).toThrow("INVALID_QR_PAYLOAD")
    expect(() => decodePayload("OCK1:a=")).toThrow("INVALID_QR_PAYLOAD")
    expect(() => decodePayload("OCK1:____")).toThrow("INVALID_QR_PAYLOAD")

    const valid = symmetricEnvelope as Extract<AnyEnvelopeV1, { type: "symmetric-key" }>
    expect(() => decodePayload(rawPayload("OCK1:", { ...valid, v: 2 }))).toThrow(
      "UNSUPPORTED_PROTOCOL_VERSION",
    )
    expect(() => decodePayload(rawPayload("OCP1:", valid))).toThrow("INVALID_QR_PAYLOAD")
    expect(() =>
      decodePayload(rawPayload("OCK1:", { ...valid, algorithm: "UNKNOWN" })),
    ).toThrow("UNSUPPORTED_ALGORITHM")
    expect(() =>
      decodePayload(
        rawPayload("OCM1:", {
          v: 1,
          type: "message",
          algorithm: "RSA-OAEP-3072+A256GCM",
        }),
      ),
    ).toThrow("UNSUPPORTED_ALGORITHM")
    const missing = {
      v: valid.v,
      type: valid.type,
      algorithm: valid.algorithm,
      keyId: valid.keyId,
      createdAt: valid.createdAt,
    }
    expect(() => decodePayload(rawPayload("OCK1:", missing))).toThrow(
      "INVALID_QR_PAYLOAD",
    )
    expect(() =>
      decodePayload(rawPayload("OCK1:", { ...valid, unexpected: true })),
    ).toThrow("INVALID_QR_PAYLOAD")
  })

  it("rejects trailing CBOR, non-map values, unknown tags, and all size excesses", () => {
    const first = rawEncoder.encode(symmetricEnvelope)
    const second = rawEncoder.encode({ extra: true })
    expect(() =>
      decodePayload(`OCK1:${toBase64Url(concatBytes(first, second))}`),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() => decodePayload(rawPayload("OCK1:", [symmetricEnvelope]))).toThrow(
      "INVALID_QR_PAYLOAD",
    )
    expect(() =>
      decodePayload(rawPayload("OCK1:", new Tag(symmetricEnvelope, 999))),
    ).toThrow("INVALID_QR_PAYLOAD")
    expect(() => decodePayload(`OCK1:${"A".repeat(8192)}`)).toThrow("INVALID_QR_PAYLOAD")
    const oversized = {
      ...(aesEnvelope() as unknown as Record<string, unknown>),
      // One byte past what a single OCM1 payload can carry. The v1 bound is
      // structural, not the post-quantum multipart ceiling.
      ciphertext: new Uint8Array(MAX_CIPHERTEXT_BYTES + 1),
    }
    expect(() => decodePayload(rawPayload("OCM1:", oversized))).toThrow(
      "INVALID_QR_PAYLOAD",
    )
  })

  it("hashes the complete ASCII payload", async () => {
    const payload = encodeEnvelopeToPayload(symmetricEnvelope)
    expect(await payloadSha256Hex(payload)).toMatch(/^[0-9a-f]{64}$/u)
    expect(await payloadSha256Hex(`${payload}A`)).not.toBe(
      await payloadSha256Hex(payload),
    )
  })
})

describe("QR sizing, rendering, and production decoder round-trips", () => {
  it("keeps the version-40 capacities and actual encoder boundaries aligned", () => {
    const capacities = { L: 2953, M: 2331, Q: 1663, H: 1273 } as const
    for (const [level, capacity] of Object.entries(capacities)) {
      const ecLevel = level as keyof typeof capacities
      expect(qrByteCapacity(ecLevel)).toBe(capacity)
      expect(payloadFits("a".repeat(capacity), ecLevel)).toBe(true)
      expect(payloadFits("a".repeat(capacity + 1), ecLevel)).toBe(false)
      expect(() =>
        QRCode.create("a".repeat(capacity), { errorCorrectionLevel: ecLevel }),
      ).not.toThrow()
      expect(() =>
        QRCode.create("a".repeat(capacity + 1), {
          errorCorrectionLevel: ecLevel,
        }),
      ).toThrow()
    }
  })

  it("separates message, stored-key, and OCF2 EC policies", () => {
    const prefs = { qrErrorCorrection: "L" as const }
    expect(ecLevelFor("message", prefs)).toBe("L")
    expect(ecLevelFor("stored-key", prefs)).toBe("H")
    expect(ecLevelFor("multipart-frame", prefs)).toBe("Q")
  })

  it("estimates by constructing same-sized envelopes", async () => {
    for (const length of [0, 512, MAX_SYMMETRIC_PLAINTEXT_BYTES]) {
      const aesActual = encodeEnvelopeToPayload(aesEnvelope(length)).length
      const aesEstimate = estimatePayloadChars(length, "A256GCM")
      expect(aesEstimate).toBeGreaterThanOrEqual(aesActual)
      expect(aesEstimate - aesActual).toBeLessThanOrEqual(16)
    }
    expect(estimatePayloadChars(MAX_SYMMETRIC_PLAINTEXT_BYTES, "A256GCM")).toBeGreaterThan(
      qrByteCapacity("Q"),
    )
    await expect(
      renderQrSvgString(encodeEnvelopeToPayload(aesEnvelope(MAX_SYMMETRIC_PLAINTEXT_BYTES)), {
        ecLevel: "Q",
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })

  it("decodes generated modules and production PNG pixels for all three QR kinds", async () => {
    for (const envelope of [aesEnvelope(), symmetricEnvelope, publicEnvelope]) {
      const payload = encodeEnvelopeToPayload(envelope)
      expect(decodeModules(payload)).toBe(payload)
      try {
        expect(await decodePng(payload)).toBe(payload)
      } catch {
        throw new Error(`PNG decode failed for ${payload.slice(0, 5)}`)
      }
    }
  })

  it("renders fixed black/white SVG and PNG data URLs and normalizes oversize errors", async () => {
    const payload = encodeEnvelopeToPayload(symmetricEnvelope)
    const svg = await renderQrSvgString(payload, { ecLevel: "H" })
    expect(svg).toMatch(/^<svg/u)
    expect(svg).toMatch(/viewBox=/u)
    expect(svg).toMatch(/#FFFFFF/iu)
    expect(svg).toMatch(/#000000/iu)
    expect(svg.trim()).toMatch(/<\/svg>$/u)
    const svgBlob = await qrSvgBlob(payload, { ecLevel: "H" })
    expect(svgBlob.type).toContain("image/svg+xml")
    expect((await svgBlob.text()).trim()).toBe(svg.trim())
    expect(await renderQrDataUrl(payload, { ecLevel: "H", size: 512 })).toMatch(
      /^data:image\/png;base64,/u,
    )
    await expect(
      renderQrSvgString("a".repeat(qrByteCapacity("H") + 1), { ecLevel: "H" }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })
})

describe("QR export file names", () => {
  it("removes unsafe/control characters, trims, truncates, and falls back", () => {
    expect(sanitizeQrFileName('  bad/\\:*?"<>|name\u0007  ')).toBe("badname")
    expect(sanitizeQrFileName("   ")).toBe("qr")
    expect(Array.from(sanitizeQrFileName("名".repeat(90)))).toHaveLength(80)
    expect(buildExportFileName(" 公開鍵 ", KEY_ID, "txt")).toBe(
      `公開鍵-${KEY_ID.slice(0, 8)}.txt`,
    )
  })
})
