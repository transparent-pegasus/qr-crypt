import {
  advance,
  asVideoElement,
  barcode,
  canvases,
  deferred,
  FakeTrack,
  FakeVideo,
  flushMicrotasks,
  getUserMedia,
  loadCameraScan,
  mediaStream,
  videoElement,
  zxingFakes,
} from "./scanner-harness"
import { beforeEach, describe, expect, it, vi } from "vitest"

const zxing = zxingFakes()

describe("frame pump", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("starts the frame pump without awaiting a never-settling video.play", async () => {
    const playback = deferred<void>()
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      play: () => playback.promise,
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockResolvedValueOnce(barcode("SCANTEXT:autoplay"))
    const scanPromise = cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      onText,
      onError,
      { once: false },
    )
    const settled = vi.fn()
    void scanPromise.then(settled)
    await flushMicrotasks()

    expect(fakeVideo.play).toHaveBeenCalledOnce()
    expect(fakeVideo.requestVideoFrameCallback).toHaveBeenCalledOnce()
    expect(
      fakeVideo.requestVideoFrameCallback!.mock.invocationCallOrder[0],
    ).toBeLessThan(fakeVideo.play.mock.invocationCallOrder[0]!)
    expect(settled).toHaveBeenCalledOnce()
    const handle = await scanPromise
    fakeVideo.fireNextVideoFrame()
    await flushMicrotasks()

    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("SCANTEXT:autoplay")
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    handle.stop()
    playback.resolve(undefined)
    await flushMicrotasks()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("fails closed through the decode-progress watchdog when the pump never schedules", async () => {
    const playback = deferred<void>()
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      play: () => playback.promise,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    const nativeSetTimeout = globalThis.setTimeout
    let suppressedTimerHandle = 1_000_000
    const setTimeoutSpy = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation(
        ((
          handler: TimerHandler,
          timeout?: number,
          ...args: unknown[]
        ) => {
          if (
            timeout === 0 ||
            timeout === cameraScan.CAMERA_FRAME_READY_TIMEOUT_MS
          ) {
            suppressedTimerHandle += 1
            return suppressedTimerHandle
          }
          return nativeSetTimeout(handler, timeout, ...args)
        }) as typeof globalThis.setTimeout,
      )

    expect(cameraScan.CAMERA_DECODE_PROGRESS_TIMEOUT_MS).toBe(12_000)
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      onError,
      { once: false },
    )
    await flushMicrotasks()

    expect(fakeVideo.play).toHaveBeenCalledOnce()
    await advance(cameraScan.CAMERA_START_TIMEOUT_MS)
    expect(onError).not.toHaveBeenCalled()
    await advance(
      cameraScan.CAMERA_DECODE_PROGRESS_TIMEOUT_MS -
        cameraScan.CAMERA_START_TIMEOUT_MS,
    )

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "QR_DECODE_PROGRESS_TIMEOUT" }),
      "failed",
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)

    setTimeoutSpy.mockRestore()
    handle.stop()
    playback.resolve(undefined)
    await flushMicrotasks()
  })

  it.each([
    {
      playError: "AbortError",
      makeTrack: () => new FakeTrack(),
      makeVideo: (play: () => Promise<void>) => new FakeVideo(0, 0, { play }),
      recover(track: FakeTrack, video: FakeVideo) {
        video.setDimensions(640, 480)
        video.dispatchEvent(new Event("loadedmetadata"))
        expect(track.muted).toBe(false)
      },
    },
    {
      playError: "NotAllowedError",
      makeTrack: () => new FakeTrack({ muted: true }),
      makeVideo: (play: () => Promise<void>) => new FakeVideo(640, 480, { play }),
      recover(track: FakeTrack) {
        track.unmute()
      },
    },
  ])(
    "recovers through readiness events after video.play rejects with $playError",
    async ({ playError, makeTrack, makeVideo, recover }) => {
      const track = makeTrack()
      const play = () =>
        Promise.reject(new DOMException("WebKit autoplay race", playError))
      const fakeVideo = makeVideo(play)
      getUserMedia.mockResolvedValue(mediaStream(track))
      const onError = vi.fn()
      const cameraScan = await loadCameraScan()
      const handle = await cameraScan.startQrScan(
        asVideoElement(fakeVideo),
        vi.fn(),
        onError,
        { once: false },
      )

      await advance(0)
      expect(zxing.readBarcodes).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(track.stop).not.toHaveBeenCalled()

      recover(track, fakeVideo)
      await advance(0)

      expect(zxing.readBarcodes).toHaveBeenCalledOnce()
      expect(onError).not.toHaveBeenCalled()
      expect(fakeVideo.play.mock.calls.length).toBeGreaterThan(1)
      expect(track.stop).not.toHaveBeenCalled()
      handle.stop()
      expect(track.stop).toHaveBeenCalledOnce()
    },
  )

  it("keeps a present-but-silent requestVideoFrameCallback on the 200 ms cadence", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const decodeStartedAt: number[] = []
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      return []
    })
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      onError,
      { once: false },
    )

    expect(fakeVideo.requestVideoFrameCallback).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    await advance(249)
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    await advance(1)

    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(fakeVideo.cancelVideoFrameCallback).toHaveBeenCalledWith(1)
    await advance(199)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    await advance(1)

    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    expect(decodeStartedAt[1]! - decodeStartedAt[0]!).toBe(200)
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    handle.stop()
  })

  it("uses a working requestVideoFrameCallback at the 200 ms cadence deadline", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      videoFrameCallbacks: true,
    })
    const decodeStartedAt: number[] = []
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      if (decodeStartedAt.length === 1) {
        setTimeout(() => fakeVideo.fireNextVideoFrame(), 200)
      }
      return []
    })
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    fakeVideo.fireNextVideoFrame()
    await flushMicrotasks()
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    await advance(199)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    await advance(1)

    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    expect(decodeStartedAt[1]! - decodeStartedAt[0]!).toBe(200)
    expect(
      fakeVideo.requestVideoFrameCallback?.mock.calls.length,
    ).toBeGreaterThan(1)
    handle.stop()
  })

  it.each([
    {
      condition: "zero-size",
      makeTrack: () => new FakeTrack(),
      makeVideo: () => new FakeVideo(0, 0),
      recover(track: FakeTrack, video: FakeVideo) {
        video.setDimensions(1280, 720)
        video.dispatchEvent(new Event("resize"))
        expect(track.muted).toBe(false)
      },
    },
    {
      condition: "muted",
      makeTrack: () => new FakeTrack({ muted: true }),
      makeVideo: () => new FakeVideo(1280, 720),
      recover(track: FakeTrack) {
        track.unmute()
      },
    },
  ])(
    "recovers from a live $condition frame and emits after real pixels are drawn",
    async ({ makeTrack, makeVideo, recover }) => {
      const track = makeTrack()
      const fakeVideo = makeVideo()
      getUserMedia.mockResolvedValue(mediaStream(track))
      const onText = vi.fn()
      const onError = vi.fn()
      const cameraScan = await loadCameraScan()
      zxing.readBarcodes.mockResolvedValueOnce(barcode("SCANTEXT:recovered"))
      const handle = await cameraScan.startQrScan(
        asVideoElement(fakeVideo),
        onText,
        onError,
      )

      await advance(0)
      expect(zxing.readBarcodes).not.toHaveBeenCalled()
      expect(onError).not.toHaveBeenCalled()
      expect(track.stop).not.toHaveBeenCalled()

      recover(track, fakeVideo)
      await advance(0)

      expect(zxing.readBarcodes).toHaveBeenCalledOnce()
      expect(onText).toHaveBeenCalledWith("SCANTEXT:recovered")
      expect(onError).not.toHaveBeenCalled()
      expect(fakeVideo.play.mock.calls.length).toBeGreaterThan(1)
      expect(track.stop).toHaveBeenCalledOnce()
      handle.stop()
    },
  )

  it("fails closed after a rejected play and persistent zero-size frame", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(0, 0, {
      play: () =>
        Promise.reject(new DOMException("WebKit autoplay race", "AbortError")),
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      onError,
      { once: false },
    )

    await advance(cameraScan.CAMERA_FRAME_READY_TIMEOUT_MS - 1)
    expect(onError).not.toHaveBeenCalled()
    await advance(1)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      "failed",
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(fakeVideo.play).toHaveBeenCalled()
    expect(fakeVideo.cancelVideoFrameCallback).toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("draws into one willReadFrequently canvas downscaled to a 1280px long edge", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(1920, 1080)
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockResolvedValue([])
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    await advance(0)
    await advance(199)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    await advance(1)

    expect(canvases).toHaveLength(1)
    const canvas = canvases[0]!
    expect(canvas.getContext).toHaveBeenCalledOnce()
    expect(canvas.getContext).toHaveBeenCalledWith("2d", {
      willReadFrequently: true,
    })
    expect(canvas.element.width).toBe(1280)
    expect(canvas.element.height).toBe(720)
    expect(canvas.drawImage).toHaveBeenCalledWith(
      asVideoElement(fakeVideo),
      0,
      0,
      1280,
      720,
    )
    expect(canvas.getImageData).toHaveBeenCalledWith(0, 0, 1280, 720)
    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    expect(zxing.readBarcodes.mock.calls[0]?.[1]).toEqual({
      formats: ["QRCodeModel2"],
      returnErrors: false,
      maxNumberOfSymbols: 1,
      tryInvert: true,
      tryRotate: true,
      tryHarder: true,
      tryDownscale: true,
    })
    handle.stop()
  })


  it("starts the next decode immediately after a decode lasting longer than 200 ms", async () => {
    const firstDecode = deferred<Array<{ text: string }>>()
    const decodeStartedAt: number[] = []
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes
      .mockImplementationOnce(() => {
        decodeStartedAt.push(Date.now())
        return firstDecode.promise
      })
      .mockImplementationOnce(async () => {
        decodeStartedAt.push(Date.now())
        return []
      })
    const handle = await cameraScan.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    await advance(0)
    await advance(250)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()

    firstDecode.resolve([])
    await flushMicrotasks()
    await advance(0)

    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    expect(decodeStartedAt[1]! - decodeStartedAt[0]!).toBe(250)
    handle.stop()
  })

  it("cancels both the pending video-frame callback and its fallback timer", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    expect(fakeVideo.pendingVideoFrameCallbacks()).toBe(1)
    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2)
    handle.stop()

    expect(fakeVideo.cancelVideoFrameCallback).toHaveBeenCalledWith(1)
    expect(fakeVideo.pendingVideoFrameCallbacks()).toBe(0)
    expect(vi.getTimerCount()).toBe(0)
    await advance(1_000)
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
  })

  it("cancels the fallback-only frame scheduler", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    const handle = await cameraScan.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    expect(vi.getTimerCount()).toBeGreaterThanOrEqual(2)
    handle.stop()

    expect(vi.getTimerCount()).toBe(0)
    await advance(1_000)
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
  })

  it("keeps completing empty decode attempts across many watchdog windows", async () => {
    const track = new FakeTrack()
    const onError = vi.fn()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockResolvedValue([])
    const handle = await cameraScan.startQrScan(
      videoElement(),
      vi.fn(),
      onError,
      { once: false },
    )

    await advance(cameraScan.CAMERA_DECODE_PROGRESS_TIMEOUT_MS * 10)

    expect(zxing.readBarcodes.mock.calls.length).toBeGreaterThan(100)
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()

    handle.stop()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })

  it("uses only the timer at a 200 ms cadence when requestVideoFrameCallback is absent", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const decodeStartedAt: number[] = []
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      return []
    })
    const handle = await cameraScan.startQrScan(
      videoElement(),
      vi.fn(),
      onError,
      { once: false },
    )

    await advance(0)
    await advance(199)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    await advance(1)

    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    expect(decodeStartedAt[1]! - decodeStartedAt[0]!).toBe(200)
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    handle.stop()
  })

  it.each([
    {
      behavior: "throws",
      name: "CanvasFrameError",
      arrange(error: Error) {
        zxing.readBarcodes.mockImplementationOnce(() => {
          throw error
        })
      },
    },
    {
      behavior: "rejects",
      name: "WasmRuntimeError",
      arrange(error: Error) {
        zxing.readBarcodes.mockRejectedValueOnce(error)
      },
    },
  ])(
    "stops with a camera error when readBarcodes $behavior",
    async ({ name, arrange }) => {
      const track = new FakeTrack()
      getUserMedia.mockResolvedValue(mediaStream(track))
      const error = new Error("decoder failed")
      error.name = name
      const onError = vi.fn()
      const cameraScan = await loadCameraScan()
      arrange(error)
      const handle = await cameraScan.startQrScan(
        videoElement(),
        vi.fn(),
        onError,
        { once: false },
      )

      await advance(0)

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
        "failed",
      )
      expect(track.stop).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      handle.stop()
    },
  )

  it("stopping before the scheduled frame pump runs removes every timer and listener", async () => {
    const playback = deferred<void>()
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      play: () => playback.promise,
    })
    const controller = new AbortController()
    const trackAdd = vi.spyOn(track, "addEventListener")
    const trackRemove = vi.spyOn(track, "removeEventListener")
    const videoAdd = vi.spyOn(fakeVideo, "addEventListener")
    const videoRemove = vi.spyOn(fakeVideo, "removeEventListener")
    const signalAdd = vi.spyOn(controller.signal, "addEventListener")
    const signalRemove = vi.spyOn(controller.signal, "removeEventListener")
    getUserMedia.mockResolvedValue(mediaStream(track))
    const cameraScan = await loadCameraScan()
    const handle = await cameraScan.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      vi.fn(),
      { once: false, signal: controller.signal },
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    controller.abort()
    await flushMicrotasks()

    for (const [type, listener] of trackAdd.mock.calls) {
      expect(trackRemove).toHaveBeenCalledWith(type, listener)
    }
    for (const [type, listener] of videoAdd.mock.calls) {
      expect(videoRemove).toHaveBeenCalledWith(type, listener)
    }
    for (const [type, listener] of signalAdd.mock.calls) {
      expect(signalRemove).toHaveBeenCalledWith(type, listener)
    }
    expect(vi.getTimerCount()).toBe(0)
    handle.stop()
    playback.resolve(undefined)
    await flushMicrotasks()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
  })
})
