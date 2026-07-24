import { expect as baseExpect, test } from "@playwright/test"
import { openOfflineApp } from "./helpers"

const expect = baseExpect.configure({ timeout: 30_000 })

test("discards and restarts the fake camera, then stops every track when closed", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000)
  await openOfflineApp(page, context, "/keys")
  await page.evaluate(() => {
    const probeWindow = window as Window & {
      __cameraProbe?: {
        streams: MediaStream[]
        restorePlay: () => void
      }
    }
    const originalPlay = HTMLMediaElement.prototype.play
    probeWindow.__cameraProbe = {
      streams: [],
      restorePlay: () => {
        HTMLMediaElement.prototype.play = originalPlay
      },
    }
    HTMLMediaElement.prototype.play = function () {
      const playing = originalPlay.call(this)
      if (this.getAttribute("aria-label") !== "Camera video for QR scanning") {
        return playing
      }
      // Keep the stream acquired and scanner startup pending to verify the UI abort.
      return playing.then(() => new Promise<void>(() => undefined))
    }
    document.addEventListener(
      "playing",
      (event) => {
        const video = event.target
        if (!(video instanceof HTMLVideoElement)) return
        if (video.getAttribute("aria-label") !== "Camera video for QR scanning") return
        const stream = video.srcObject
        if (!(stream instanceof MediaStream)) return
        const probe = probeWindow.__cameraProbe!
        if (!probe.streams.includes(stream)) probe.streams.push(stream)
      },
      { capture: true },
    )
  })
  const bundleTab = page.getByRole("tab", {
    name: "Import",
    exact: true,
  })
  await bundleTab.click()
  await expect(bundleTab).toHaveAttribute("data-state", "active")
  await expect(
    page.getByRole("heading", { name: "Scan with the camera", exact: true }),
  ).toBeVisible()
  await expect(
    page.getByRole("heading", {
      name: "Paste a payload",
      exact: true,
    }),
  ).toBeVisible()
  await expect(
    page.getByText("Ask the other party to increase their screen brightness"),
  ).toBeVisible()
  const scanTrigger = page.getByRole("button", {
    name: "Scan a key QR code",
    exact: true,
  })
  await expect(scanTrigger).toBeEnabled()
  await scanTrigger.click()

  const dialog = page.getByRole("dialog", { name: "Scan a key QR code" })
  await expect(dialog).toBeVisible()
  const video = dialog.getByLabel("Camera video for QR scanning")
  await expect(video).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const streams = (
          window as Window & {
            __cameraProbe?: { streams: MediaStream[] }
          }
        ).__cameraProbe?.streams
        const stream = streams?.at(-1)
        return (
          stream instanceof MediaStream &&
          stream.getTracks().some((track) => track.readyState === "live")
        )
      }),
    )
    .toBe(true)

  await page
    .getByRole("button", { name: "Discard scan state", exact: true })
    .click()
  await expect(
    page.getByRole("button", { name: "Start camera", exact: true }),
  ).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const streams = (
          window as Window & {
            __cameraProbe?: { streams: MediaStream[] }
          }
        ).__cameraProbe?.streams
        const stream = streams?.at(-1)
        return (
          stream instanceof MediaStream &&
          stream.getTracks().every((track) => track.readyState === "ended")
        )
      }),
    )
    .toBe(true)

  await page
    .getByRole("button", { name: "Start camera", exact: true })
    .click()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const streams = (
          window as Window & {
            __cameraProbe?: { streams: MediaStream[] }
          }
        ).__cameraProbe?.streams
        const stream = streams?.at(-1)
        return (
          (streams?.length ?? 0) >= 2 &&
          stream instanceof MediaStream &&
          stream.getTracks().some((track) => track.readyState === "live")
        )
      }),
    )
    .toBe(true)

  await dialog.getByRole("button", { name: "Close", exact: true }).click()
  await expect(dialog).not.toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const streams = (
          window as Window & {
            __cameraProbe?: { streams: MediaStream[] }
          }
        ).__cameraProbe?.streams
        const stream = streams?.at(-1)
        return (
          stream instanceof MediaStream &&
          stream.getTracks().every((track) => track.readyState === "ended")
        )
      }),
    )
    .toBe(true)

  await page.evaluate(() => {
    const probe = (
      window as Window & {
        __cameraProbe?: { restorePlay: () => void }
      }
    ).__cameraProbe
    probe?.restorePlay()
  })
})
