import { readFile } from "node:fs/promises"
import { metaCspFromHeaders } from "../../scripts/csp-from-headers.mjs"
import { collectAnimatedFramePayloads, decodePng } from "../e2e/helpers"
import { loadRelayMessages, type RelayMessages } from "../fixtures/relay-messages"
import { APP_ORIGIN, expect, observeDocument, test } from "./native-fixture"
import { cameraSnapshot, installSyntheticCamera } from "./synthetic-camera"

let messages: RelayMessages
test.beforeAll(async () => {
  messages = await loadRelayMessages()
  expect(messages.sym).toHaveLength(1)
  expect(messages.pq).toHaveLength(2)
})

test("the initial and reloaded EXE window has the exact origin, CSP and full candidate identity", async ({
  native,
  page,
}) => {
  const csp = metaCspFromHeaders(await readFile("public/_headers", "utf8"))
  for (const observation of [native.initial, await observeDocument(page)]) {
    expect(observation.origin).toBe(APP_ORIGIN)
    expect(observation.secure).toBe(true)
    expect(observation.csp).toBe(csp)
    expect(observation.referrer).toBe("no-referrer")
    expect(observation.heading).toMatch(/^QR Crypt (?:Relay|リレー)$/)
    expect(observation.body).toContain(native.version)
    expect(observation.body).toContain(native.buildSha)
  }
  await expect(page.getByText("Version", { exact: true })).toBeVisible()
  await expect(page.getByText(native.version, { exact: true })).toBeVisible()
  await expect(page.getByText("Build", { exact: true })).toBeVisible()
  await expect(page.getByText(native.buildSha, { exact: true })).toBeVisible()
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: "日本語", exact: true }).click()
  await expect(
    page.getByRole("heading", { level: 1, name: "QR Crypt リレー", exact: true }),
  ).toBeVisible()
  await expect(page.getByText("バージョン", { exact: true })).toBeVisible()
  await expect(page.getByText("ビルド", { exact: true })).toBeVisible()
  await expect(page.getByText(native.version, { exact: true })).toBeVisible()
  await expect(page.getByText(native.buildSha, { exact: true })).toBeVisible()
  await page.getByRole("combobox").click()
  await page.getByRole("option", { name: "English", exact: true }).click()
  await native.assertBundleTraffic()
})

test("sym and multi-frame PQ paste produces decodable PNGs and close/reopen clears the session", async ({
  native,
  page,
}) => {
  for (const payloads of [messages.sym, messages.pq]) {
    await page.getByRole("button", { name: "Text → QR", exact: true }).click()
    const playback = page.getByRole("dialog", {
      name: "Turn relay text into QR",
      exact: true,
    })
    await playback.getByLabel("Relay text", { exact: true }).fill(payloads.join("\n"))
    await playback.getByRole("button", { name: "Show QR", exact: true }).click()
    if (payloads.length === 1) {
      const image = playback.getByRole("img")
      await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
      expect(
        decodePng(
          Buffer.from((await image.getAttribute("src"))!.split(",", 2)[1]!, "base64"),
        ),
      ).toBe(payloads[0])
    } else {
      expect(await collectAnimatedFramePayloads(playback)).toEqual(payloads)
    }
    await playback.getByRole("button", { name: "Close", exact: true }).click()
    await expect(playback).toBeHidden()
    await page.getByRole("button", { name: "Text → QR", exact: true }).click()
    await expect(playback.getByLabel("Relay text", { exact: true })).toHaveValue("")
    await expect(playback.getByRole("img")).toHaveCount(0)
    await playback.getByRole("button", { name: "Close", exact: true }).click()
  }
  await native.assertBundleTraffic()
})

test("non-message outer artifacts are rejected without displaying an image", async ({
  native,
  page,
}) => {
  await page.getByRole("button", { name: "Text → QR", exact: true }).click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
    exact: true,
  })
  await playback.getByLabel("Relay text", { exact: true }).fill(messages.nonMessage)
  await playback.getByRole("button", { name: "Show QR", exact: true }).click()
  await expect(
    playback.getByText(
      "The frame's outer header does not declare pq-message or sym-message.",
      { exact: true },
    ),
  ).toBeVisible()
  await expect(playback.getByRole("img")).toHaveCount(0)
  await native.assertBundleTraffic()
})

test("synthetic camera pixels traverse bundled WASM and trusted copy writes complete native clipboard text", async ({
  native,
  page,
}, testInfo) => {
  await installSyntheticCamera(page, messages.pq)
  expect(await cameraSnapshot(page)).toEqual({
    calls: 0,
    pending: 0,
    stopCalls: 0,
    tracks: [],
  })
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to text", exact: true })
  const start = capture.getByRole("button", { name: "Start camera", exact: true })
  await expect(start).toBeEnabled()
  expect((await cameraSnapshot(page)).calls).toBe(0)
  await start.click()
  const text = messages.pq.join("\n")
  await expect(capture.getByLabel("Relay text", { exact: true })).toHaveValue(text)
  await expect.poll(async () => (await cameraSnapshot(page)).tracks).toEqual(["ended"])
  const before = "native-relay-prior-text-state"
  expect(await native.seedClipboard(before)).toEqual({ text: before, png: null })
  await capture.getByRole("button", { name: "Copy relay text", exact: true }).click()
  await expect.poll(async () => (await native.readClipboard()).text).toBe(text)
  const clipboard = await native.readClipboard()
  expect(clipboard.text).toBe(text)
  await testInfo.attach("synthetic-camera-native-text.json", {
    body: Buffer.from(
      JSON.stringify({
        syntheticCamera: true,
        physicalGesture: false,
        camera: await cameraSnapshot(page),
        expectedText: text,
        nativeText: clipboard.text,
      }),
    ),
    contentType: "application/json",
  })
  await native.assertBundleTraffic(true)
})

test("synthetic sym capture and trusted PNG copy produce a decodable native clipboard bitmap", async ({
  native,
  page,
}, testInfo) => {
  await installSyntheticCamera(page, messages.sym)
  await page.getByRole("button", { name: "QR → QR", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to QR", exact: true })
  await capture.getByRole("button", { name: "Start camera", exact: true }).click()
  const image = capture.getByRole("img", { name: "Relayed message QR code", exact: true })
  await expect(image).toHaveAttribute("src", /^data:image\/png;base64,/)
  expect(
    decodePng(
      Buffer.from((await image.getAttribute("src"))!.split(",", 2)[1]!, "base64"),
    ),
  ).toBe(messages.sym[0])
  await expect.poll(async () => (await cameraSnapshot(page)).tracks).toEqual(["ended"])
  const before = "native-relay-prior-bitmap-state"
  expect(await native.seedClipboard(before)).toEqual({ text: before, png: null })
  await capture.getByRole("button", { name: "Copy QR image", exact: true }).click()
  await expect
    .poll(async () => {
      const { png } = await native.readClipboard()
      return png === null ? null : decodePng(Buffer.from(png, "base64"))
    })
    .toBe(messages.sym[0])
  const clipboard = await native.readClipboard()
  expect(clipboard.png).not.toBeNull()
  const bytes = Buffer.from(clipboard.png!, "base64")
  expect(decodePng(bytes)).toBe(messages.sym[0])
  await testInfo.attach("native-clipboard.png", { body: bytes, contentType: "image/png" })
  await testInfo.attach("synthetic-camera-native-png.json", {
    body: Buffer.from(
      JSON.stringify({
        syntheticCamera: true,
        physicalGesture: false,
        camera: await cameraSnapshot(page),
        nativeDecodedFrame: decodePng(bytes),
      }),
    ),
    contentType: "application/json",
  })
  await native.assertBundleTraffic(true)
})
