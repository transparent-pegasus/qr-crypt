import { expect, test } from "@playwright/test"
import { goToOfflinePage, openOfflineApp } from "./helpers"

test("fake camera をインライン停止し、画面離脱でも全 track を停止する", async ({
  context,
  page,
}) => {
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
  await page.getByRole("tab", { name: "鍵を読み取る", exact: true }).click()

  const video = page.getByLabel("QRコード読取用カメラ映像")
  await expect(video).toBeVisible()
  await expect(page.getByText("起動ボタンを押すとカメラを開始します")).toBeVisible()
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click()
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

  await goToOfflinePage(page, "/encrypt")
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
