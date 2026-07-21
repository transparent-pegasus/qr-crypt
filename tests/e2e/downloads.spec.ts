import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import {
  BinaryBitmap,
  DecodeHintType,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"
import { createSymmetricKey, encryptWithStoredKey } from "./helpers"

function decodePng(buffer: Buffer): string {
  const png = PNG.sync.read(buffer)
  const isDark = (x: number, y: number) => png.data[(y * png.width + x) * 4]! < 128
  let finderX = -1
  let finderY = -1
  for (let y = 0; y < png.height && finderY < 0; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (!isDark(x, y)) continue
      finderX = x
      finderY = y
      break
    }
  }
  if (finderX < 0 || finderY < 0) throw new Error("Downloaded PNG has no QR modules")

  // The first dark run is the seven-module top edge of the top-left finder.
  // Derive the QR version, then sample module centers to remove fractional
  // 512px canvas scaling before passing the downloaded image to ZXing.
  let finderWidth = 0
  while (finderX + finderWidth < png.width && isDark(finderX + finderWidth, finderY)) {
    finderWidth += 1
  }
  const estimatedModules = png.width / (finderWidth / 7) - 8
  const version = Math.round((estimatedModules - 21) / 4) + 1
  if (version < 1 || version > 40) throw new Error("Downloaded PNG has invalid QR size")
  const moduleCount = 17 + version * 4
  const quietModules = 4
  const outputScale = 4
  const outputWidth = (moduleCount + quietModules * 2) * outputScale
  const luminance = new Uint8ClampedArray(outputWidth * outputWidth).fill(255)
  const sourcePitch = png.width / (moduleCount + quietModules * 2)
  for (let row = 0; row < moduleCount; row += 1) {
    for (let column = 0; column < moduleCount; column += 1) {
      const sourceX = Math.floor((quietModules + column + 0.5) * sourcePitch)
      const sourceY = Math.floor((quietModules + row + 0.5) * sourcePitch)
      if (!isDark(sourceX, sourceY)) continue
      const outputX = (quietModules + column) * outputScale
      const outputY = (quietModules + row) * outputScale
      for (let y = 0; y < outputScale; y += 1) {
        luminance.fill(
          0,
          (outputY + y) * outputWidth + outputX,
          (outputY + y) * outputWidth + outputX + outputScale,
        )
      }
    }
  }
  const source = new RGBLuminanceSource(luminance, outputWidth, outputWidth)
  const hints = new Map([[DecodeHintType.PURE_BARCODE, true]])
  return new QRCodeReader()
    .decode(new BinaryBitmap(new HybridBinarizer(source)), hints)
    .getText()
}

test("PNG と SVG のダウンロード内容が画面のペイロードと一致する", async ({
  page,
}) => {
  const keyName = "出力確認鍵"
  await createSymmetricKey(page, keyName)
  const { payload } = await encryptWithStoredKey(page, {
    keyName,
    plaintext: "ダウンロードしたQRを再読取する日本語平文",
  })

  const result = page.getByRole("region", { name: "暗号結果" })
  await result.getByLabel("QR名", { exact: true }).fill("ダウンロード確認")

  const pngDownloadPromise = page.waitForEvent("download")
  await result.getByRole("button", { name: "PNG", exact: true }).click()
  const pngDownload = await pngDownloadPromise
  expect(pngDownload.suggestedFilename()).toMatch(
    /^[^/\\]+-[A-Za-z0-9_-]{8}\.png$/,
  )
  const pngPath = await pngDownload.path()
  expect(pngPath).not.toBeNull()
  if (pngPath === null) throw new Error("PNG download path was unavailable")
  expect(decodePng(await readFile(pngPath))).toBe(payload)

  const svgDownloadPromise = page.waitForEvent("download")
  await result.getByRole("button", { name: "SVG", exact: true }).click()
  const svgDownload = await svgDownloadPromise
  expect(svgDownload.suggestedFilename()).toMatch(
    /^[^/\\]+-[A-Za-z0-9_-]{8}\.svg$/,
  )
  const svgPath = await svgDownload.path()
  expect(svgPath).not.toBeNull()
  if (svgPath === null) throw new Error("SVG download path was unavailable")
  const svg = await readFile(svgPath, "utf8")

  const svgAnalysis = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml")
    const root = document.documentElement
    const parseError = document.querySelector("parsererror") !== null
    const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/) ?? []
    const [x, y, width, height] = viewBox
    const isWhite = (element: Element) => {
      const fill = element.getAttribute("fill")?.toLowerCase()
      return fill === "#fff" || fill === "#ffffff" || fill === "white"
    }
    const coversViewBox = (element: Element) => {
      if (x === undefined || y === undefined || width === undefined || height === undefined) {
        return false
      }
      if (element.localName === "rect") {
        return (
          (element.getAttribute("x") ?? "0") === x &&
          (element.getAttribute("y") ?? "0") === y &&
          element.getAttribute("width") === width &&
          element.getAttribute("height") === height
        )
      }
      // qrcode は全 viewBox を覆う背景長方形を path で表す版がある。
      const compactPath = element.getAttribute("d")?.replaceAll(/\s+/g, "")
      return compactPath === `M${x}${y}h${width}v${height}H${x}z`
    }
    const whiteBackgroundRectangle = Array.from(root.children).some(
      (element) => isWhite(element) && coversViewBox(element),
    )
    return {
      rootIsSvg: root.localName === "svg",
      parseError,
      whiteBackgroundRectangle,
    }
  }, svg)
  expect(svgAnalysis.rootIsSvg).toBe(true)
  expect(svgAnalysis.parseError).toBe(false)
  expect(svgAnalysis.whiteBackgroundRectangle).toBe(true)
})
