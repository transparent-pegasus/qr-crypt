import { expect, test } from "@playwright/test"
import { openOfflineApp } from "./helpers"

test("fake camera の起動中にダイアログを閉じると全 track を停止する", async ({
  context,
  page,
}) => {
  await openOfflineApp(page, context, "/keys")
  await page.evaluate(() => {
    const probeWindow = window as Window & {
      __cameraProbe?: {
        playing: boolean
        hadLiveTrack: boolean
        stream: MediaStream | null
        restorePlay: () => void
      }
    }
    const originalPlay = HTMLMediaElement.prototype.play
    probeWindow.__cameraProbe = {
      playing: false,
      hadLiveTrack: false,
      stream: null,
      restorePlay: () => {
        HTMLMediaElement.prototype.play = originalPlay
      },
    }
    HTMLMediaElement.prototype.play = function () {
      const playing = originalPlay.call(this)
      if (this.getAttribute("aria-label") !== "QRコード読取用カメラ映像") {
        return playing
      }
      // 新実装の「stream 取得済み・scanner 起動待ち」を保ち、close 時の abort を検証する。
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
        probeWindow.__cameraProbe = {
          ...probeWindow.__cameraProbe!,
          playing: true,
          hadLiveTrack: stream.getTracks().some((track) => track.readyState === "live"),
          stream,
        }
      },
      { capture: true },
    )
  })
  await page.getByRole("tab", { name: "鍵を読み取る", exact: true }).click()
  await page.getByRole("button", { name: "単枚共通鍵QRを読み取る", exact: true }).click()

  const scanner = page.getByRole("dialog", { name: "共通鍵QRを読み取る" })
  const video = scanner.getByLabel("QRコード読取用カメラ映像")
  await expect(video).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const probe = (
          window as Window & {
            __cameraProbe?: { playing: boolean; hadLiveTrack: boolean }
          }
        ).__cameraProbe
        return probe?.playing === true && probe.hadLiveTrack
      }),
    )
    .toBe(true)
  await expect(scanner.getByText("カメラを準備しています…")).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => {
        const stream = (
          window as Window & { __cameraProbe?: { stream: MediaStream | null } }
        ).__cameraProbe?.stream
        return (
          stream instanceof MediaStream &&
          stream.getTracks().some((track) => track.readyState === "live")
        )
      }),
    )
    .toBe(true)

  await scanner.getByRole("button", { name: "キャンセル" }).click()
  await expect(scanner).toBeHidden()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const stream = (
          window as Window & { __cameraProbe?: { stream: MediaStream | null } }
        ).__cameraProbe?.stream
        return (
          stream === null ||
          stream === undefined ||
          (stream instanceof MediaStream &&
            stream.getTracks().every((track) => track.readyState === "ended"))
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
