import { expect as baseExpect, test } from "@playwright/test"
import { openOfflineApp } from "./helpers"

const expect = baseExpect.configure({ timeout: 30_000 })

test("fake camera をモーダルで停止し、閉じると全 track を停止する", async ({
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
      if (this.getAttribute("aria-label") !== "QRコード読取用カメラ映像") {
        return playing
      }
      // stream 取得済み・scanner 起動待ちを保ち、UI の abort を検証する。
      return playing.then(() => new Promise<void>(() => undefined))
    }
    document.addEventListener(
      "playing",
      (event) => {
        const video = event.target
        if (!(video instanceof HTMLVideoElement)) return
        if (video.getAttribute("aria-label") !== "QRコード読取用カメラ映像") return
        const stream = video.srcObject
        if (!(stream instanceof MediaStream)) return
        const probe = probeWindow.__cameraProbe!
        if (!probe.streams.includes(stream)) probe.streams.push(stream)
      },
      { capture: true },
    )
  })
  const bundleTab = page.getByRole("tab", {
    name: "相手の公開鍵",
    exact: true,
  })
  await bundleTab.click()
  await expect(bundleTab).toHaveAttribute("data-state", "active")
  const scanTrigger = page.getByRole("button", {
    name: "鍵QRを読み取る",
    exact: true,
  })
  await expect(scanTrigger).toBeEnabled()
  await scanTrigger.click()

  const dialog = page.getByRole("dialog", { name: "鍵QRを読み取る" })
  await expect(dialog).toBeVisible()
  const video = dialog.getByLabel("QRコード読取用カメラ映像")
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

  await page.getByRole("button", { name: "カメラを停止", exact: true }).click()
  await expect(
    page.getByRole("button", { name: "カメラを再起動", exact: true }),
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
    .getByRole("button", { name: "カメラを再起動", exact: true })
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
