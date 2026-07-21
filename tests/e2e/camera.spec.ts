import { expect, test } from "@playwright/test"

test("fake camera の映像を再生しダイアログ終了時に全 track を停止する", async ({
  page,
}) => {
  await page.goto("/keys")
  await page.evaluate(() => {
    const probeWindow = window as Window & {
      __cameraProbe?: {
        playing: boolean
        hadLiveTrack: boolean
        stream: MediaStream | null
      }
    }
    probeWindow.__cameraProbe = {
      playing: false,
      hadLiveTrack: false,
      stream: null,
    }
    document.addEventListener(
      "playing",
      (event) => {
        const video = event.target
        if (!(video instanceof HTMLVideoElement)) return
        const stream = video.srcObject
        if (!(stream instanceof MediaStream)) return
        probeWindow.__cameraProbe = {
          playing: true,
          hadLiveTrack: stream.getTracks().some((track) => track.readyState === "live"),
          stream,
        }
      },
      { capture: true, once: true },
    )
  })
  await page.getByRole("tab", { name: "鍵を読み取る", exact: true }).click()
  await page.getByRole("button", { name: "カメラを起動", exact: true }).click()

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
  await expect(scanner.getByText("QRコードを枠内に合わせてください")).toBeVisible()

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
})
