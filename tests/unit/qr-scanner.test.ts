import { beforeEach, describe, expect, it, vi } from "vitest"

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
  rejection: undefined as Error | undefined,
  controlsStop: vi.fn(),
}))

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    async decodeFromVideoDevice(
      _deviceId: string | undefined,
      _video: HTMLVideoElement,
      callback: ScannerCallback,
    ): Promise<{ stop(): void }> {
      scanner.callback = callback
      if (scanner.rejection !== undefined) throw scanner.rejection
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
  scanner.rejection = undefined
  scanner.controlsStop.mockReset()
  vi.stubGlobal("MediaStream", FakeMediaStream)
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

  it.each([
    ["NotAllowedError", "CAMERA_PERMISSION_DENIED"],
    ["NotFoundError", "CAMERA_NOT_AVAILABLE"],
    ["NotReadableError", "CAMERA_NOT_AVAILABLE"],
  ] as const)("maps %s startup rejection to %s", async (name, code) => {
    const { video, track } = videoWithTrack()
    scanner.rejection = new DOMException("camera", name)
    const onError = vi.fn()
    await expect(startQrScan(video, vi.fn(), onError)).rejects.toMatchObject({ code })
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code }))
    expect(track.stop).toHaveBeenCalledTimes(1)
  })
})
