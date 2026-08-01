import { describe, expect, it } from "vitest"
import { PNG } from "pngjs"
import * as QRCode from "qrcode"
import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"
import {
  payloadFits,
  qrByteCapacity,
  renderQrDataUrl,
  renderQrSvgString,
} from "@/qr/encode"
import { buildExportFileName, qrSvgBlob, sanitizeQrFileName } from "@/qr/export-image"
import { decodePayload, payloadSha256Hex } from "@/qr/payload"
import {
  OCK1_SYMMETRIC_KEY,
  OCM1_MESSAGE_33,
  OCP1_PUBLIC_KEY,
} from "../fixtures/relay-v1"

const KEY_ID = "B".repeat(22)
const FRAME_PAYLOAD = "OCF2:ZnJhbWUtb25seQ"

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

describe("v2-only payload decoding", () => {
  it.each([
    ["OCM1 message", OCM1_MESSAGE_33],
    ["OCK1 symmetric key", OCK1_SYMMETRIC_KEY],
    ["OCP1 public key", OCP1_PUBLIC_KEY],
  ])("rejects a previously valid %s at the prefix boundary", (_name, payload) => {
    expect(() => decodePayload(payload)).toThrow("INVALID_QR_PREFIX")
  })

  it.each(["OCB1:AA", "XYZ1:abc"])("rejects the unrecognized prefix in %s", (payload) => {
    expect(() => decodePayload(payload)).toThrow("INVALID_QR_PREFIX")
  })

  it("hashes the complete ASCII payload", async () => {
    expect(await payloadSha256Hex(FRAME_PAYLOAD)).toMatch(/^[0-9a-f]{64}$/u)
    expect(await payloadSha256Hex(`${FRAME_PAYLOAD}A`)).not.toBe(
      await payloadSha256Hex(FRAME_PAYLOAD),
    )
  })
})

describe("QR sizing, rendering, and production decoder round-trips", () => {
  it("exports the fixed render style shared by every QR renderer", async () => {
    const encode = (await import("@/qr/encode")) as unknown as Record<string, unknown>

    expect(encode["QR_RENDER_STYLE"]).toEqual({
      margin: 4,
      color: { dark: "#000000", light: "#FFFFFFFF" },
    })
  })

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

  it("decodes generated frame modules and production PNG pixels", async () => {
    expect(decodeModules(FRAME_PAYLOAD)).toBe(FRAME_PAYLOAD)
    expect(await decodePng(FRAME_PAYLOAD)).toBe(FRAME_PAYLOAD)
  })

  it("renders fixed black/white SVG and PNG data URLs and normalizes oversize errors", async () => {
    const svg = await renderQrSvgString(FRAME_PAYLOAD, { ecLevel: "H" })
    expect(svg).toMatch(/^<svg/u)
    expect(svg).toMatch(/viewBox=/u)
    expect(svg).toMatch(/#FFFFFF/iu)
    expect(svg).toMatch(/#000000/iu)
    expect(svg.trim()).toMatch(/<\/svg>$/u)
    const svgBlob = await qrSvgBlob(FRAME_PAYLOAD, { ecLevel: "H" })
    expect(svgBlob.type).toContain("image/svg+xml")
    expect((await svgBlob.text()).trim()).toBe(svg.trim())
    expect(await renderQrDataUrl(FRAME_PAYLOAD, { ecLevel: "H", size: 512 })).toMatch(
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
