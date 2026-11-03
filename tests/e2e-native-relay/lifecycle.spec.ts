import type { Page } from "@playwright/test"
import { loadRelayMessages, type RelayMessages } from "../fixtures/relay-messages"
import { syntheticRelayPlayback } from "../fixtures/relay-playback"
import { expect, test } from "./native-fixture"
import {
  cameraSnapshot,
  installSyntheticCamera,
  releaseSyntheticCamera,
} from "./synthetic-camera"

let messages: RelayMessages
test.beforeAll(async () => {
  messages = await loadRelayMessages()
})

async function expectEmptyPlayback(page: Page): Promise<void> {
  await expect(page.getByRole("dialog")).toHaveCount(0)
  await page.getByRole("button", { name: "Text → QR", exact: true }).click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
    exact: true,
  })
  await expect(playback.getByLabel("Relay text", { exact: true })).toHaveValue("")
  await expect(playback.getByRole("img")).toHaveCount(0)
}

test("OS minimize ends active synthetic camera tracks and restore never resumes capture", async ({
  native,
  page,
}, testInfo) => {
  await installSyntheticCamera(page, [])
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to text", exact: true })
  await capture.getByRole("button", { name: "Start camera", exact: true }).click()
  await expect
    .poll(cameraSnapshot.bind(null, page))
    .toEqual({ calls: 1, pending: 0, stopCalls: 0, tracks: ["live"] })
  await expect
    .poll(() =>
      capture
        .locator("video")
        .evaluate((video: HTMLVideoElement) => !video.paused && video.currentTime > 0),
    )
    .toBe(true)
  await native.minimize()
  await expect.poll(async () => (await cameraSnapshot(page)).tracks).toEqual(["ended"])
  await native.restore()
  await expect(capture).toBeHidden()
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  await expect(
    capture.getByRole("button", { name: "Start camera", exact: true }),
  ).toBeEnabled()
  await expect(capture.getByLabel("Relay text", { exact: true })).toHaveCount(0)
  await expect(capture.getByRole("img")).toHaveCount(0)
  expect(await cameraSnapshot(page)).toMatchObject({
    calls: 1,
    pending: 0,
    tracks: ["ended"],
  })
  expect((await cameraSnapshot(page)).stopCalls).toBeGreaterThanOrEqual(1)
  await testInfo.attach("synthetic-camera-OS-lifecycle.json", {
    body: Buffer.from(JSON.stringify(await cameraSnapshot(page))),
    contentType: "application/json",
  })
  await native.assertBundleTraffic(true)
})

test("OS minimize cancels still-pending acquisition and ends a stream resolved after restore", async ({
  native,
  page,
}, testInfo) => {
  await installSyntheticCamera(page, messages.sym, true)
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  const capture = page.getByRole("dialog", { name: "QR to text", exact: true })
  await capture.getByRole("button", { name: "Start camera", exact: true }).click()
  await expect
    .poll(cameraSnapshot.bind(null, page))
    .toEqual({ calls: 1, pending: 1, stopCalls: 0, tracks: ["live"] })
  const pendingBeforeOS = await cameraSnapshot(page)
  const minimized = await native.minimize()
  expect((await cameraSnapshot(page)).pending).toBe(1)
  await native.restore()
  await expect(capture).toBeHidden()
  await releaseSyntheticCamera(page)
  await expect
    .poll(cameraSnapshot.bind(null, page))
    .toMatchObject({ calls: 1, pending: 0, tracks: ["ended"] })
  expect((await cameraSnapshot(page)).stopCalls).toBeGreaterThanOrEqual(1)
  await expect(capture).toBeHidden()
  await page.getByRole("button", { name: "QR → Text", exact: true }).click()
  await expect(
    capture.getByRole("button", { name: "Start camera", exact: true }),
  ).toBeEnabled()
  await expect(capture.getByLabel("Relay text", { exact: true })).toHaveCount(0)
  await expect(capture.getByRole("img")).toHaveCount(0)
  expect((await cameraSnapshot(page)).calls).toBe(1)
  await testInfo.attach("synthetic-held-acquisition.json", {
    body: Buffer.from(
      JSON.stringify({
        timingInstrumentation: "held test-side getUserMedia promise",
        pendingBeforeOS,
        minimized,
        afterRelease: await cameraSnapshot(page),
      }),
    ),
    contentType: "application/json",
  })
  await native.assertBundleTraffic(true)
})

test("OS minimize clears playing frames and restore/reopen has no auto-resume", async ({
  native,
  page,
}) => {
  await page.getByRole("button", { name: "Text → QR", exact: true }).click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
    exact: true,
  })
  await playback.getByLabel("Relay text", { exact: true }).fill(messages.pq.join("\n"))
  await playback.getByRole("button", { name: "Show QR", exact: true }).click()
  await expect(playback.getByRole("img")).toBeVisible()
  const counter = playback.getByText(/^\d+ \/ 2$/).last()
  const before = await counter.innerText()
  await expect(counter).not.toHaveText(before)
  await native.minimize()
  await native.restore()
  await expectEmptyPlayback(page)
  await native.assertBundleTraffic()
})

interface PreparationProbe {
  renders: number
  firstTimerAtRender: number | null
  completedAt: number | null
}
type PreparationWindow = Window &
  typeof globalThis & { __nativePreparation: PreparationProbe }

test("OS minimize cancels whole-set preparation while real canvas rendering is still pending", async ({
  native,
  page,
}, testInfo) => {
  const fixture = syntheticRelayPlayback(128)
  await page.getByRole("button", { name: "Text → QR", exact: true }).click()
  const playback = page.getByRole("dialog", {
    name: "Turn relay text into QR",
    exact: true,
  })
  await playback.getByLabel("Relay text", { exact: true }).fill(fixture.text)
  // Timing instrumentation only: keep real serialization and the application's between-frame yields.
  await page.evaluate(() => {
    const probe: PreparationProbe = {
      renders: 0,
      firstTimerAtRender: null,
      completedAt: null,
    }
    ;(window as PreparationWindow).__nativePreparation = probe
    const serialize = HTMLCanvasElement.prototype.toDataURL
    HTMLCanvasElement.prototype.toDataURL = function (...args) {
      const result = serialize.apply(this, args)
      probe.renders += 1
      if (probe.renders === 1)
        setTimeout(() => {
          probe.firstTimerAtRender = probe.renders
        }, 0)
      const deadline = performance.now() + 150
      while (performance.now() < deadline) {
        /* Deliberately slow the real synchronous serialization boundary. */
      }
      if (probe.renders === 128) probe.completedAt = Date.now()
      return result
    }
  })
  await playback.getByRole("button", { name: "Show QR", exact: true }).click()
  const snapshot = () =>
    page.evaluate(() => ({ ...(window as PreparationWindow).__nativePreparation }))
  await expect.poll(async () => (await snapshot()).firstTimerAtRender).not.toBeNull()
  const pendingBeforeOS = await snapshot()
  expect(pendingBeforeOS.renders).toBeGreaterThan(0)
  expect(pendingBeforeOS.renders).toBeLessThan(128)
  expect(pendingBeforeOS.firstTimerAtRender).toBe(1)
  expect(pendingBeforeOS.completedAt).toBeNull()
  await expect(playback.getByRole("img")).toHaveCount(0)
  const minimized = await native.minimize()
  const afterMinimize = await snapshot()
  expect(
    afterMinimize.completedAt,
    "preparation must still be pending at the actual OS operation",
  ).toBeNull()
  expect(afterMinimize.renders).toBeLessThan(128)
  await native.restore()
  await expectEmptyPlayback(page)
  await page.evaluate(
    () =>
      new Promise<void>((done) =>
        requestAnimationFrame(() => requestAnimationFrame(() => done())),
      ),
  )
  expect((await snapshot()).renders).toBe(afterMinimize.renders)
  await expect(playback.getByRole("img")).toHaveCount(0)
  await testInfo.attach("pending-real-canvas-preparation.json", {
    body: Buffer.from(
      JSON.stringify({
        timingInstrumentation:
          "150ms per actual canvas serialization; real product yield retained",
        totalFrames: 128,
        pendingBeforeOS,
        minimized,
        afterMinimize,
        afterRestore: await snapshot(),
      }),
    ),
    contentType: "application/json",
  })
  await native.assertBundleTraffic()
})
