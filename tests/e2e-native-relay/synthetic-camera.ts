import type { Page } from "@playwright/test"
import * as QRCode from "qrcode"

interface CameraProbe {
  calls: number
  pending: number
  stopCalls: number
  streams: MediaStream[]
  release(): void
}

type CameraWindow = Window & typeof globalThis & { __nativeCamera: CameraProbe }

// Synthetic pixels enter getUserMedia; the embedded renderer, frame pump and WASM decoder remain real.
export async function installSyntheticCamera(
  page: Page,
  payloads: string[],
  hold = false,
): Promise<void> {
  const images = await Promise.all(
    payloads.map((payload) =>
      QRCode.toDataURL(payload, { errorCorrectionLevel: "Q", width: 1024, margin: 4 }),
    ),
  )
  await page.evaluate(
    async ({ images, hold }) => {
      const frames = await Promise.all(
        images.map(async (source) => {
          const image = new Image()
          image.src = source
          await image.decode()
          return image
        }),
      )
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 1024
      const drawing = canvas.getContext("2d")
      if (drawing === null || typeof canvas.captureStream !== "function")
        throw new Error("Synthetic canvas capture is unavailable")
      let index = 0
      const draw = () => {
        drawing.fillStyle = "white"
        drawing.fillRect(0, 0, canvas.width, canvas.height)
        if (frames.length) {
          drawing.drawImage(
            frames[index++ % frames.length]!,
            0,
            0,
            canvas.width,
            canvas.height,
          )
        }
      }
      draw()
      const timer = setInterval(draw, 600)
      window.addEventListener("pagehide", () => clearInterval(timer), { once: true })
      let release = () => undefined as void
      const held = new Promise<void>((done) => {
        release = done
      })
      const probe: CameraProbe = {
        calls: 0,
        pending: 0,
        stopCalls: 0,
        streams: [],
        release: () => release(),
      }
      ;(window as CameraWindow).__nativeCamera = probe
      navigator.mediaDevices.getUserMedia = async (constraints) => {
        if (constraints?.audio) throw new Error("Relay requested microphone access")
        if (!constraints?.video) throw new Error("Relay did not request video")
        probe.calls += 1
        const stream = canvas.captureStream(15)
        probe.streams.push(stream)
        for (const track of stream.getTracks()) {
          const stop = track.stop.bind(track)
          track.stop = () => {
            probe.stopCalls += 1
            stop()
          }
        }
        probe.pending += 1
        if (hold) await held
        probe.pending -= 1
        return stream
      }
    },
    { images, hold },
  )
}

export async function cameraSnapshot(
  page: Page,
): Promise<{
  calls: number
  pending: number
  stopCalls: number
  tracks: MediaStreamTrackState[]
}> {
  return page.evaluate(() => {
    const { calls, pending, stopCalls, streams } = (window as CameraWindow).__nativeCamera
    return {
      calls,
      pending,
      stopCalls,
      tracks: streams.flatMap((stream) =>
        stream.getTracks().map((track) => track.readyState),
      ),
    }
  })
}

export async function releaseSyntheticCamera(page: Page): Promise<void> {
  await page.evaluate(() => (window as CameraWindow).__nativeCamera.release())
}
