import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface MockResult {
  getText(): string
}

interface MockNamedError {
  name: string
}

type ScannerCallback = (
  result: MockResult | undefined,
  error: MockNamedError | undefined,
  controls: { stop(): void },
) => void

const scanner = vi.hoisted(() => ({
  callback: undefined as ScannerCallback | undefined,
  rejections: [] as Array<Error | undefined>,
  acquire: vi.fn(),
  controlsStop: vi.fn(),
}))

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    async decodeFromVideoDevice(
      _deviceId: string | undefined,
      _video: HTMLVideoElement,
      callback: ScannerCallback,
    ): Promise<{ stop(): void }> {
      scanner.acquire()
      scanner.callback = callback
      const rejection = scanner.rejections.shift()
      if (rejection !== undefined) throw rejection
      return { stop: scanner.controlsStop }
    }
  },
}))

import { startQrScan } from "@/qr/decode"

class FakeTrack {
  readonly stop = vi.fn()
}

class FakeMediaStream {
  constructor(private readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

function videoWithTrack(): { video: HTMLVideoElement; track: FakeTrack } {
  const track = new FakeTrack()
  const video = { srcObject: new FakeMediaStream([track]) } as unknown as HTMLVideoElement
  return { video, track }
}

beforeEach(() => {
  scanner.callback = undefined
  scanner.rejections.splice(0)
  scanner.acquire.mockReset()
  scanner.controlsStop.mockReset()
  vi.stubGlobal("MediaStream", FakeMediaStream)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("camera scanner lifecycle", () => {
  it("emits once, then stops controls and every track", async () => {
    const { video, track } = videoWithTrack()
    const onText = vi.fn()
    const onError = vi.fn()
    await startQrScan(video, onText, onError)
    const controls = { stop: scanner.controlsStop }
    scanner.callback?.({ getText: () => "OCK1:value" }, undefined, controls)
    scanner.callback?.({ getText: () => "OCK1:second" }, undefined, controls)
    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith("OCK1:value")
    expect(onError).not.toHaveBeenCalled()
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })

  it("makes explicit close/unmount stop idempotent", async () => {
    const { video, track } = videoWithTrack()
    const handle = await startQrScan(video, vi.fn(), vi.fn(), { once: false })
    handle.stop()
    handle.stop()
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it("keeps scanning for transient decode misses", async () => {
    const { video, track } = videoWithTrack()
    const onError = vi.fn()
    const handle = await startQrScan(video, vi.fn(), onError)
    scanner.callback?.(
      undefined,
      { name: "NotFoundException" },
      { stop: scanner.controlsStop },
    )
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    handle.stop()
  })

  it("rejects NotAllowedError immediately as CAMERA_PERMISSION_DENIED", async () => {
    const { video, track } = videoWithTrack()
    scanner.rejections.push(new DOMException("camera", "NotAllowedError"))
    const onError = vi.fn()
    await expect(startQrScan(video, vi.fn(), onError)).rejects.toMatchObject({
      code: "CAMERA_PERMISSION_DENIED",
    })
    expect(scanner.acquire).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_PERMISSION_DENIED" }),
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it("retries a transient NotReadableError and resolves without emitting an error", async () => {
    vi.useFakeTimers()
    const { video, track } = videoWithTrack()
    scanner.rejections.push(new DOMException("camera", "NotReadableError"))
    const onError = vi.fn()
    const scanPromise = startQrScan(video, vi.fn(), onError)

    await vi.advanceTimersByTimeAsync(300)

    await expect(scanPromise).resolves.toBeDefined()
    expect(scanner.acquire).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it("rejects a persistent NotReadableError after three retries", async () => {
    vi.useFakeTimers()
    const { video } = videoWithTrack()
    scanner.rejections.push(
      ...Array.from(
        { length: 4 },
        () => new DOMException("camera", "NotReadableError"),
      ),
    )
    const onError = vi.fn()
    const rejection = expect(startQrScan(video, vi.fn(), onError)).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })

    await vi.advanceTimersByTimeAsync(900)

    await rejection
    expect(scanner.acquire).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledTimes(1)
  })

  it("does not acquire again when aborted during retry backoff", async () => {
    vi.useFakeTimers()
    const { video } = videoWithTrack()
    scanner.rejections.push(new DOMException("camera", "AbortError"))
    const controller = new AbortController()
    const rejection = expect(
      startQrScan(video, vi.fn(), vi.fn(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await Promise.resolve()
    await Promise.resolve()

    controller.abort()
    await vi.advanceTimersByTimeAsync(300)

    await rejection
    expect(scanner.acquire).toHaveBeenCalledTimes(1)
  })
})
