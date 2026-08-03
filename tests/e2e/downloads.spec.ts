import { readFile } from "node:fs/promises"
import { expect, test, type Download, type Locator } from "@playwright/test"
import {
  PQ_ALGORITHM_LABEL,
  chooseOption,
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

async function animatedFrameCount(scope: Locator): Promise<number> {
  const text = await scope.getByText(/^\d+ \/ \d+$/).last().innerText()
  const match = text.match(/^\d+ \/ (\d+)$/)
  if (match === null) throw new Error("Animated QR frame counter is invalid")
  return Number(match[1])
}

test("a one-frame symmetric encryption downloads its OCF2 QR as one PNG with no SVG affordance", async ({
  context,
  page,
}) => {
  const keyName = "出力確認鍵"
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, keyName)
  const { framePayload } = await encryptWithStoredKey(page, {
    keyName,
    plaintext: "ダウンロードしたQRを再読取する日本語平文",
  })

  const result = page.getByRole("dialog", { name: "Encryption complete" })
  await result.getByLabel("Output name", { exact: true }).fill("ダウンロード確認")
  const downloadButton = result.getByRole("button", {
    name: "Download",
    exact: true,
  })
  await expect(downloadButton).toHaveCount(1)
  await expect(result.getByRole("button", { name: /SVG/i })).toHaveCount(0)

  const pngDownloadPromise = page.waitForEvent("download")
  await downloadButton.click()
  const pngDownload = await pngDownloadPromise
  expect(pngDownload.suggestedFilename()).toMatch(/^[^/\\]+-[A-Za-z0-9_-]{8}\.png$/)
  expect(decodePng(await downloadBuffer(pngDownload))).toBe(framePayload)
})

test("the key-list modal downloads one secret PNG or one multi-frame ZIP with no SVG affordance", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  const symmetricName = "一覧出力秘密鍵"
  const identityName = "一覧出力PQ-ID"
  await openOfflineApp(page, context, "/keys")
  await createSymmetricKey(page, symmetricName)

  await goToOfflinePage(page, "/keys")
  await page.getByRole("button", { name: new RegExp(symmetricName) }).click()
  let dialog = page.getByRole("dialog", { name: symmetricName })
  await dialog
    .getByRole("button", { name: "Show secret-key QR", exact: true })
    .click()
  dialog = page.getByRole("dialog", { name: "Shared-key QR" })
  await dialog
    .getByRole("checkbox", { name: "I understand the risk" })
    .check()
  await expect(dialog.getByRole("button", { name: /SVG/i })).toHaveCount(0)

  const secretPngPromise = page.waitForEvent("download")
  const secretDownload = dialog.getByRole("button", {
    name: "Download",
    exact: true,
  })
  await expect(secretDownload).toHaveCount(1)
  await secretDownload.click()
  const secretPng = await secretPngPromise
  expect(secretPng.suggestedFilename()).toMatch(
    /^一覧出力秘密鍵-[A-Za-z0-9_-]{8}\.png$/,
  )
  expect(decodePng(await downloadBuffer(secretPng))).toMatch(/^OCF2:/)

  await dialog.getByRole("button", { name: "Back to details" }).click()
  await page
    .getByRole("dialog", { name: symmetricName })
    .getByRole("button", { name: "Close", exact: true })
    .click()
  await goToOfflinePage(page, "/keys")
  await createPqIdentity(page, identityName)

  await goToOfflinePage(page, "/keys")
  await page.getByRole("button", { name: new RegExp(identityName) }).click()
  dialog = page.getByRole("dialog", { name: identityName })
  await dialog
    .getByRole("button", { name: "Show public-key QR", exact: true })
    .click()
  dialog = page.getByRole("dialog", {
    name: `${identityName} public key`,
  })
  const frames = dialog.getByRole("region", {
    name: `${identityName} public key frame display`,
  })
  await expect
    .poll(() => animatedFrameCount(frames), { timeout: 30_000 })
    .toBeLessThanOrEqual(10)
  const publicFrameCount = await animatedFrameCount(frames)
  expect(publicFrameCount).toBeGreaterThan(1)
  await expect(frames.getByRole("button", { name: /SVG/i })).toHaveCount(0)
  const publicDownload = frames.getByRole("button", {
    name: "Download",
    exact: true,
  })
  await expect(publicDownload).toHaveCount(1)

  const publicZipPromise = page.waitForEvent("download")
  await publicDownload.click()
  const publicZip = await publicZipPromise
  expect(publicZip.suggestedFilename()).toMatch(
    /public key-.+-frames\.zip$/,
  )
  const archive = parseStoreOnlyZip(await downloadBuffer(publicZip))
  expect(archive.centralCount).toBe(publicFrameCount)
  expect(archive.entries).toHaveLength(publicFrameCount)
  expect(archive.entries.map((entry) => entry.name)).toEqual(
    Array.from(
      { length: publicFrameCount },
      (_, index) => `frame-${String(index + 1).padStart(2, "0")}.png`,
    ),
  )
  expect(
    archive.entries.every(
      (entry) => entry.data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    ),
  ).toBe(true)
  expect(
    new Set(archive.entries.map((entry) => entry.data.toString("base64"))).size,
  ).toBe(publicFrameCount)
})

test("controls signed multipart frames and preserves every PNG in its single ZIP", async ({
  context,
  page,
}) => {
  test.setTimeout(240_000)
  const identityName = "複数出力PQ-ID"
  const plaintext = "x".repeat(4_096)
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  const { result } = await encryptSignedPq(page, { identityName, plaintext })
  const frames = result.getByRole("region", { name: "Ciphertext frame display" })
  await expect
    .poll(() => animatedFrameCount(frames), { timeout: 30_000 })
    .toBeLessThanOrEqual(20)
  const frameCount = Number.parseInt(await detailValue(result, "QR frame count"), 10)
  // The default 1,000-byte preference still gives this signed artifact enough
  // frames to exercise zero-padded names and the ZIP path.
  expect(frameCount).toBeGreaterThan(9)
  expect(frameCount).toBeLessThanOrEqual(20)
  expect(await animatedFrameCount(frames)).toBe(frameCount)

  await expect(frames.getByRole("slider")).toHaveCount(0)
  await expect(frames.getByRole("button", { name: /SVG/i })).toHaveCount(0)
  await expect(
    frames.getByRole("button", { name: "Download", exact: true }),
  ).toHaveCount(0)
  const counter = frames.getByText(/^\d+ \/ \d+$/).last()
  await frames.getByRole("button", { name: "Pause" }).click()
  const initialCounter = await counter.innerText()
  await frames.getByRole("button", { name: "Next" }).click()
  await expect(counter).not.toHaveText(initialCounter)
  await frames.getByRole("button", { name: "Previous" }).click()
  await expect(counter).toHaveText(initialCounter)

  await frames.getByRole("button", { name: "View full screen" }).click()
  const fullscreen = page.getByRole("dialog", {
    name: /View Ciphertext \d+ \/ \d+ full screen/,
  })
  await expect(fullscreen.getByRole("img", { name: /Full-screen .* image/ })).toBeVisible()
  await fullscreen.getByRole("button", { name: "Close" }).click()

  const framePayloads = await collectAnimatedFramePayloads(frames)
  expect(framePayloads).toHaveLength(frameCount)
  expect(framePayloads.every((payload) => payload.startsWith("OCF2:"))).toBe(true)
  const output = result.getByTestId("encrypt-result-output")
  await output.getByLabel("Output name", { exact: true }).fill("署名付き複数フレーム")
  const downloadButton = output.getByRole("button", {
    name: "Download",
    exact: true,
  })
  await expect(downloadButton).toHaveCount(1)

  const zipPromise = page.waitForEvent("download", { timeout: 180_000 })
  await downloadButton.click()
  const zipDownload = await zipPromise
  expect(zipDownload.suggestedFilename()).toMatch(/-frames\.zip$/)
  const zip = parseStoreOnlyZip(await downloadBuffer(zipDownload))
  expect(zip.centralCount).toBe(frameCount)
  expect(zip.entries).toHaveLength(frameCount)
  expect(zip.entries.every((entry) => /^frame-\d{2,3}\.png$/.test(entry.name))).toBe(
    true,
  )
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

test("measures a maximum 120000-byte signed PQ message through ZIP production", async ({
  context,
  page,
}, testInfo) => {
  test.setTimeout(600_000)
  const identityName = "最大長計測PQ-ID"
  const plaintextBytes = 120_000
  await openOfflineApp(page, context, "/keys")
  await createPqIdentity(page, identityName)
  await seedSelfPublicBundle(page, identityName)
  await goToOfflinePage(page, "/encrypt")
  await chooseOption(
    page,
    "Cryptographic algorithm",
    PQ_ALGORITHM_LABEL,
  )
  await chooseOption(page, "Recipient ML-KEM public key", /^Verified: /)
  await chooseOption(page, "My ML-DSA signing identity", identityName)

  const plaintext = page.getByLabel("Plaintext", { exact: true })
  const encryptButton = page.getByRole("button", {
    name: "Encrypt",
    exact: true,
  })
  await plaintext.fill("x".repeat(plaintextBytes + 1))
  await expect(
    page.getByText("The plaintext limit has been exceeded", { exact: true }),
  ).toBeVisible()
  await expect(encryptButton).toBeDisabled()

  await plaintext.fill("x".repeat(plaintextBytes))
  await expect(
    page.getByText(`${plaintextBytes} / ${plaintextBytes} bytes`, { exact: true }),
  ).toBeVisible()
  await expect(
    page.getByText("The plaintext limit has been exceeded", { exact: true }),
  ).toHaveCount(0)
  await expect(encryptButton).toBeEnabled()

  await page.evaluate(() => {
    const markNames = [
      "nodisp-encrypt-start",
      "nodisp-encrypt-complete",
      "nodisp-split-complete",
      "nodisp-first-frame-rendered",
    ]
    for (const name of markNames) performance.clearMarks(name)
    performance.mark("nodisp-encrypt-start")
    const markOnce = (name: string) => {
      if (performance.getEntriesByName(name, "mark").length === 0) {
        performance.mark(name)
      }
    }
    const inspect = () => {
      const result = document.querySelector('[data-testid="encrypt-result-detail"]')
      if (result !== null) markOnce("nodisp-encrypt-complete")
      const frames = document.querySelector(
        'section[aria-label="Ciphertext frame display"]',
      )
      if (frames !== null) markOnce("nodisp-split-complete")
      const image = frames?.querySelector(
        'img[alt^="Ciphertext "][alt$=" image"]',
      )
      if (
        image instanceof HTMLImageElement &&
        image.src.startsWith("data:image/png;base64,")
      ) {
        markOnce("nodisp-first-frame-rendered")
      }
    }
    const observer = new MutationObserver(inspect)
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["src"],
      childList: true,
      subtree: true,
    })
    ;(window as unknown as Record<string, unknown>).__nodispMeasurementObserver =
      observer
    inspect()
  })
  await encryptButton.click()

  const result = page.getByRole("dialog", { name: "Encryption complete" })
  await expect(result).toBeVisible({ timeout: 120_000 })
  const frames = result.getByRole("region", {
    name: "Ciphertext frame display",
  })
  const firstFrame = frames.getByRole("img", {
    name: /^Ciphertext \d+ \/ \d+ image$/,
  })
  await expect(firstFrame).toHaveAttribute("src", /^data:image\/png;base64,/, {
    timeout: 180_000,
  })

  const artifactBytes = Number.parseInt(
    await detailValue(result, "Total data size"),
    10,
  )
  const frameCount = Number.parseInt(
    await detailValue(result, "QR frame count"),
    10,
  )
  expect(artifactBytes).toBe(126_576)
  expect(frameCount).toBe(127)
  await expect(frames.getByRole("button", { name: /SVG/i })).toHaveCount(0)
  await expect(
    frames.getByRole("button", { name: "Download", exact: true }),
  ).toHaveCount(0)
  const output = result.getByTestId("encrypt-result-output")
  await output.getByLabel("Output name", { exact: true }).fill("最大長署名付きメッセージ")
  const downloadButton = output.getByRole("button", {
    name: "Download",
    exact: true,
  })
  await expect(downloadButton).toHaveCount(1)

  const renderMarks = await page.evaluate(() => {
    const markTime = (name: string) => {
      const mark = performance.getEntriesByName(name, "mark")[0]
      if (mark === undefined) throw new Error(`Missing performance mark: ${name}`)
      return mark.startTime
    }
    return {
      start: markTime("nodisp-encrypt-start"),
      encrypted: markTime("nodisp-encrypt-complete"),
      split: markTime("nodisp-split-complete"),
      firstFrame: markTime("nodisp-first-frame-rendered"),
    }
  })

  const zipStartedAt = Date.now()
  const zipPromise = page.waitForEvent("download", { timeout: 300_000 })
  await downloadButton.click()
  const zipDownload = await zipPromise
  expect(zipDownload.suggestedFilename()).toMatch(/-frames\.zip$/)
  const zipBytes = await downloadBuffer(zipDownload)
  const zipMs = Date.now() - zipStartedAt
  const zip = parseStoreOnlyZip(zipBytes)
  expect(zip.centralCount).toBe(frameCount)
  expect(zip.entries).toHaveLength(frameCount)
  expect(zip.entries.map((entry) => entry.name)).toEqual(
    Array.from(
      { length: frameCount },
      (_, index) => `frame-${String(index + 1).padStart(2, "0")}.png`,
    ),
  )
  expect(
    zip.entries.every(
      (entry) => entry.data.subarray(0, 8).toString("hex") === "89504e470d0a1a0a",
    ),
  ).toBe(true)
  expect(
    new Set(zip.entries.map((entry) => entry.data.toString("base64"))).size,
  ).toBe(frameCount)

  const metrics = {
    plaintextBytes,
    artifactBytes,
    frameCount,
    encryptMs: Math.round(renderMarks.encrypted - renderMarks.start),
    splitMs: Math.round(renderMarks.split - renderMarks.encrypted),
    firstFrameRenderMs: Math.round(renderMarks.firstFrame - renderMarks.split),
    zipMs,
    archiveBytes: zipBytes.byteLength,
  }
  expect(metrics.encryptMs).toBeGreaterThanOrEqual(0)
  expect(metrics.splitMs).toBeGreaterThanOrEqual(0)
  expect(metrics.firstFrameRenderMs).toBeGreaterThanOrEqual(0)
  expect(metrics.zipMs).toBeGreaterThanOrEqual(0)
  await testInfo.attach("long-text-metrics.json", {
    body: JSON.stringify(metrics, null, 2),
    contentType: "application/json",
  })
})
