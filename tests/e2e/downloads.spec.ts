import { readFile } from "node:fs/promises"
import { expect, test } from "@playwright/test"
import { PNG } from "pngjs"
import {
  BinaryBitmap,
  HybridBinarizer,
  QRCodeReader,
  RGBLuminanceSource,
} from "@zxing/library"
import { createSymmetricKey, encryptWithStoredKey } from "./helpers"

function decodePng(buffer: Buffer): string {
  const png = PNG.sync.read(buffer)
  const luminance = new Uint8ClampedArray(png.width * png.height)
  for (let index = 0; index < luminance.length; index += 1) {
    luminance[index] = png.data[index * 4]!
  }
  const source = new RGBLuminanceSource(luminance, png.width, png.height)
  return new QRCodeReader()
    .decode(new BinaryBitmap(new HybridBinarizer(source)))
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
