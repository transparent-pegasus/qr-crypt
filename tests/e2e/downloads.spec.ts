import { readFile } from "node:fs/promises"
import { expect, test, type Download } from "@playwright/test"
import {
  collectAnimatedFramePayloads,
  createPqIdentity,
  createSymmetricKey,
  decodePng,
  detailValue,
  encryptSignedPq,
  encryptWithStoredKey,
  goToOfflinePage,
  openOfflineApp,
  seedSelfPublicBundle,
} from "./helpers"

interface ZipEntry {
  name: string
  data: Buffer
}

function parseStoreOnlyZip(buffer: Buffer): {
  entries: ZipEntry[]
  centralCount: number
} {
  const entries: ZipEntry[] = []
  let offset = 0
  while (offset + 30 <= buffer.length && buffer.readUInt32LE(offset) === 0x04034b50) {
    expect(buffer.readUInt16LE(offset + 8)).toBe(0)
    const compressedSize = buffer.readUInt32LE(offset + 18)
    const uncompressedSize = buffer.readUInt32LE(offset + 22)
    expect(compressedSize).toBe(uncompressedSize)
    const nameLength = buffer.readUInt16LE(offset + 26)
    const extraLength = buffer.readUInt16LE(offset + 28)
    const nameStart = offset + 30
    const dataStart = nameStart + nameLength + extraLength
    const dataEnd = dataStart + compressedSize
    expect(dataEnd).toBeLessThanOrEqual(buffer.length)
    entries.push({
      name: buffer.subarray(nameStart, nameStart + nameLength).toString("utf8"),
      data: buffer.subarray(dataStart, dataEnd),
    })
    offset = dataEnd
  }
  expect(buffer.readUInt32LE(offset)).toBe(0x02014b50)
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]))
  expect(eocdOffset).toBeGreaterThan(offset)
  return { entries, centralCount: buffer.readUInt16LE(eocdOffset + 10) }
}

async function downloadBuffer(download: Download): Promise<Buffer> {
  const path = await download.path()
  expect(path).not.toBeNull()
  if (path === null) throw new Error("Download path was unavailable")
  return readFile(path)
}

test("PNG と SVG のダウンロード内容が画面のペイロードと一致する", async ({
  context,
  page,
}) => {
  const keyName = "出力確認鍵"
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)
  const { payload } = await encryptWithStoredKey(page, {
    keyName,
    plaintext: "ダウンロードしたQRを再読取する日本語平文",
  })

  const result = page.getByRole("region", { name: "暗号結果" })
  await result.getByLabel("出力名", { exact: true }).fill("ダウンロード確認")

  const pngDownloadPromise = page.waitForEvent("download")
  await result.getByRole("button", { name: "PNG", exact: true }).click()
  const pngDownload = await pngDownloadPromise
  expect(pngDownload.suggestedFilename()).toMatch(/^[^/\\]+-[A-Za-z0-9_-]{8}\.png$/)
  expect(decodePng(await downloadBuffer(pngDownload))).toBe(payload)

  const svgDownloadPromise = page.waitForEvent("download")
  await result.getByRole("button", { name: "SVG", exact: true }).click()
  const svgDownload = await svgDownloadPromise
  expect(svgDownload.suggestedFilename()).toMatch(/^[^/\\]+-[A-Za-z0-9_-]{8}\.svg$/)
  const svg = (await downloadBuffer(svgDownload)).toString("utf8")

  const svgAnalysis = await page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml")
    const root = document.documentElement
    const viewBox = root.getAttribute("viewBox")?.trim().split(/\s+/) ?? []
    const [x, y, width, height] = viewBox
    const isWhite = (element: Element) => {
      const fill = element.getAttribute("fill")?.toLowerCase()
      return fill === "#fff" || fill === "#ffffff" || fill === "white"
    }
    const coversViewBox = (element: Element) => {
      if (
        x === undefined ||
        y === undefined ||
        width === undefined ||
        height === undefined
      ) {
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
      const compactPath = element.getAttribute("d")?.replaceAll(/\s+/g, "")
      return compactPath === `M${x}${y}h${width}v${height}H${x}z`
    }
    return {
      rootIsSvg: root.localName === "svg",
      parseError: document.querySelector("parsererror") !== null,
      whiteBackgroundRectangle: Array.from(root.children).some(
        (element) => isWhite(element) && coversViewBox(element),
      ),
    }
  }, svg)
  expect(svgAnalysis).toEqual({
    rootIsSvg: true,
    parseError: false,
    whiteBackgroundRectangle: true,
  })
})

test("署名付き複数フレームを操作し ZIP と全 PNG を実ファイルとして出力する", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const identityName = "複数出力PQ-ID"
  const plaintext = "署名付き複数フレームを一時停止し前後移動して出力確認する本文"
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  // Chromium は単一操作からの多数の個別 download を 10 件で抑止する。
  // maximum の署名付き fixture も全 PNG 検証が可能なフレーム数に保つ。
  await goToOfflinePage(page, "/settings")
  const frameBytes = page.getByLabel(/1フレームの生データ/)
  await frameBytes.fill("900")
  await expect(frameBytes).toHaveValue("900")
  const { result } = await encryptSignedPq(page, { identityName, plaintext })
  const frameCount = Number.parseInt(await detailValue(result, "QRフレーム数"), 10)
  expect(frameCount).toBeGreaterThan(1)

  const frames = result.getByRole("region", { name: "暗号文フレーム表示" })
  const counter = frames.getByText(/^\d+ \/ \d+$/).last()
  await frames.getByRole("button", { name: "一時停止" }).click()
  const initialCounter = await counter.innerText()
  await frames.getByRole("button", { name: "次のフレーム" }).click()
  await expect(counter).not.toHaveText(initialCounter)
  await frames.getByRole("button", { name: "前のフレーム" }).click()
  await expect(counter).toHaveText(initialCounter)
  await frames.getByLabel("表示速度").fill("150")
  await expect(frames.getByText("150 ms", { exact: true })).toBeVisible()

  await frames.getByRole("button", { name: "全画面表示" }).click()
  const fullscreen = page.getByRole("dialog", { name: /暗号文 \d+ \/ \d+を全画面表示/ })
  await expect(fullscreen.getByRole("img", { name: /全画面画像/ })).toBeVisible()
  await fullscreen.getByRole("button", { name: "閉じる" }).click()

  const framePayloads = await collectAnimatedFramePayloads(frames)
  expect(framePayloads).toHaveLength(frameCount)
  expect(framePayloads.every((payload) => payload.startsWith("OCF2:"))).toBe(true)
  await result.getByLabel("出力名", { exact: true }).fill("署名付き複数フレーム")

  const pngDownloads: Download[] = []
  const capturePng = (download: Download) => pngDownloads.push(download)
  page.on("download", capturePng)
  await frames.getByRole("button", { name: "PNGを一括出力" }).click()
  await expect.poll(() => pngDownloads.length, { timeout: 60_000 }).toBe(frameCount)
  page.off("download", capturePng)

  const downloadedPayloads: string[] = []
  for (const download of pngDownloads) {
    expect(download.suggestedFilename()).toMatch(/-frame-\d{2}\.png$/)
    const bytes = await downloadBuffer(download)
    expect(bytes.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a")
    downloadedPayloads.push(decodePng(bytes))
  }
  expect(new Set(downloadedPayloads)).toEqual(new Set(framePayloads))

  const zipPromise = page.waitForEvent("download")
  await frames.getByRole("button", { name: "ZIPで出力" }).click()
  const zipDownload = await zipPromise
  expect(zipDownload.suggestedFilename()).toMatch(/-frames\.zip$/)
  const zip = parseStoreOnlyZip(await downloadBuffer(zipDownload))
  expect(zip.centralCount).toBe(frameCount)
  expect(zip.entries).toHaveLength(frameCount)
  expect(zip.entries.map((entry) => entry.name)).toEqual(
    Array.from(
      { length: frameCount },
      (_, index) => `frame-${String(index + 1).padStart(2, "0")}.png`,
    ),
  )
  expect(new Set(zip.entries.map((entry) => decodePng(entry.data)))).toEqual(
    new Set(framePayloads),
  )
})
