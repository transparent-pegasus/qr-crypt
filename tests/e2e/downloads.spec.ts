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

test("PNG and SVG download contents match the on-screen payload", async ({
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

  const result = page.getByRole("region", { name: "Encryption result" })
  await result.getByLabel("Output name", { exact: true }).fill("ダウンロード確認")

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

test("exports a secret-key QR and public-key-bundle QR from the key-list modal", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const symmetricName = "一覧出力秘密鍵"
  const identityName = "一覧出力PQ-ID"
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, symmetricName)

  await goToOfflinePage(page, "/saved")
  await page.getByRole("button", { name: new RegExp(symmetricName) }).click()
  let dialog = page.getByRole("dialog", { name: symmetricName })
  await dialog
    .getByRole("button", { name: "Show secret-key QR", exact: true })
    .click()
  dialog = page.getByRole("dialog", { name: "Symmetric-key QR" })
  await dialog
    .getByRole("checkbox", { name: "I understand the risk" })
    .check()

  const secretPngPromise = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "PNG", exact: true }).click()
  const secretPng = await secretPngPromise
  expect(secretPng.suggestedFilename()).toMatch(
    /^一覧出力秘密鍵-[A-Za-z0-9_-]{8}\.png$/,
  )
  expect(decodePng(await downloadBuffer(secretPng))).toMatch(/^OCK1:/)

  const secretSvgPromise = page.waitForEvent("download")
  await dialog.getByRole("button", { name: "SVG", exact: true }).click()
  const secretSvg = await secretSvgPromise
  expect(secretSvg.suggestedFilename()).toMatch(
    /^一覧出力秘密鍵-[A-Za-z0-9_-]{8}\.svg$/,
  )
  expect((await downloadBuffer(secretSvg)).toString("utf8")).toContain("<svg")

  await dialog.getByRole("button", { name: "Back to details" }).click()
  await page
    .getByRole("dialog", { name: symmetricName })
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await goToOfflinePage(page, "/keys")
  await createPqIdentity(page, identityName)

  await goToOfflinePage(page, "/saved")
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  dialog = page.getByRole("dialog", { name: identityName })
  await dialog
    .getByRole("button", { name: "Public-key bundle QR", exact: true })
    .click()
  dialog = page.getByRole("dialog", {
    name: `${identityName} public-key bundle`,
  })
  const frames = dialog.getByRole("region", {
    name: `${identityName} public-key bundle frame display`,
  })
  const payloads = await collectAnimatedFramePayloads(frames)
  expect(payloads.length).toBeGreaterThan(0)
  expect(payloads.every((payload) => payload.startsWith("OCF2:"))).toBe(true)

  const publicSvgPromise = page.waitForEvent("download")
  await frames.getByRole("button", { name: "Current SVG" }).click()
  const publicSvg = await publicSvgPromise
  expect(publicSvg.suggestedFilename()).toMatch(
    /public-key bundle-.+-frame-\d{2}\.svg$/,
  )
  expect((await downloadBuffer(publicSvg)).toString("utf8")).toContain("<svg")
})

test("controls signed multipart frames and exports the ZIP and every PNG as real files", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const identityName = "複数出力PQ-ID"
  const plaintext = "署名付き複数フレームを一時停止し前後移動して出力確認する本文"
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  // Chromium suppresses individual downloads beyond 10 from one user action.
  // Keep the maximum signed fixture within a frame count that allows every PNG
  // to be verified.
  await goToOfflinePage(page, "/settings")
  const frameBytes = page.getByLabel(/Raw data per frame/)
  await frameBytes.fill("900")
  await expect(frameBytes).toHaveValue("900")
  const { result } = await encryptSignedPq(page, { identityName, plaintext })
  const frameCount = Number.parseInt(await detailValue(result, "QR frame count"), 10)
  expect(frameCount).toBeGreaterThan(1)

  const frames = result.getByRole("region", { name: "Ciphertext frame display" })
  const counter = frames.getByText(/^\d+ \/ \d+$/).last()
  await frames.getByRole("button", { name: "Pause" }).click()
  const initialCounter = await counter.innerText()
  await frames.getByRole("button", { name: "Next frame" }).click()
  await expect(counter).not.toHaveText(initialCounter)
  await frames.getByRole("button", { name: "Previous frame" }).click()
  await expect(counter).toHaveText(initialCounter)
  await frames.getByLabel("Display speed").fill("2500")
  await expect(frames.getByText("2500 ms", { exact: true })).toBeVisible()

  await frames.getByRole("button", { name: "View full screen" }).click()
  const fullscreen = page.getByRole("dialog", {
    name: /View Ciphertext \d+ \/ \d+ full screen/,
  })
  await expect(fullscreen.getByRole("img", { name: /Full-screen .* image/ })).toBeVisible()
  await fullscreen.getByRole("button", { name: "Close" }).first().click()

  const framePayloads = await collectAnimatedFramePayloads(frames)
  expect(framePayloads).toHaveLength(frameCount)
  expect(framePayloads.every((payload) => payload.startsWith("OCF2:"))).toBe(true)
  await result.getByLabel("Output name", { exact: true }).fill("署名付き複数フレーム")

  const pngDownloads: Download[] = []
  const capturePng = (download: Download) => pngDownloads.push(download)
  page.on("download", capturePng)
  await frames.getByRole("button", { name: "Export all PNGs" }).click()
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
  await frames.getByRole("button", { name: "Export ZIP" }).click()
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
