import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { MultipartScanSession } from "@/features/multipart-scan-session"
import { TransferAssembler } from "@/qr/multipart/assemble"
import type { TransferState } from "@/qr/multipart/transfer-state"

const zxing = vi.hoisted(() => ({
  prepareZXingModule: vi.fn(),
  purgeZXingModule: vi.fn(),
  readBarcodes: vi.fn(),
}))

vi.mock("zxing-wasm/reader", () => ({
  prepareZXingModule: zxing.prepareZXingModule,
  purgeZXingModule: zxing.purgeZXingModule,
  readBarcodes: zxing.readBarcodes,
}))

vi.mock("zxing-wasm/reader/zxing_reader.wasm?url", () => ({
  default: "/assets/zxing_reader-test-hash.wasm",
}))

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class FakeTrack extends EventTarget {
  readonly kind = "video"
  readyState: MediaStreamTrackState = "live"
  muted: boolean

  constructor(options?: { muted?: boolean }) {
    super()
    this.muted = options?.muted ?? false
  }

  readonly stop = vi.fn(() => {
    this.readyState = "ended"
  })

  end(): void {
    this.readyState = "ended"
    this.dispatchEvent(new Event("ended"))
  }

  unmute(): void {
    this.muted = false
    this.dispatchEvent(new Event("unmute"))
  }
}

class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

const getUserMedia =
  vi.fn<(constraints: MediaStreamConstraints) => Promise<MediaStream>>()

function mediaStream(...tracks: FakeTrack[]): MediaStream {
  return new FakeMediaStream(tracks) as unknown as MediaStream
}

type FakeVideoFrameCallback = (now: number, metadata: object) => void

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null
  videoWidth: number
  videoHeight: number
  readyState: number
  readonly play: ReturnType<typeof vi.fn<() => Promise<void>>>
  readonly requestVideoFrameCallback:
    | ReturnType<typeof vi.fn<(callback: FakeVideoFrameCallback) => number>>
    | undefined
  readonly cancelVideoFrameCallback:
    | ReturnType<typeof vi.fn<(handle: number) => void>>
    | undefined

  private nextFrameHandle = 1
  private readonly frameCallbacks = new Map<number, FakeVideoFrameCallback>()

  constructor(
    width = 640,
    height = 480,
    options?: {
      readyState?: number
      play?: () => Promise<void>
      videoFrameCallbacks?: boolean
    },
  ) {
    super()
    this.videoWidth = width
    this.videoHeight = height
    this.readyState = options?.readyState ?? 2
    this.play = vi.fn(options?.play ?? (async () => undefined))

    if (options?.videoFrameCallbacks === true) {
      this.requestVideoFrameCallback = vi.fn((callback: FakeVideoFrameCallback) => {
        const handle = this.nextFrameHandle
        this.nextFrameHandle += 1
        this.frameCallbacks.set(handle, callback)
        return handle
      })
      this.cancelVideoFrameCallback = vi.fn((handle: number) => {
        this.frameCallbacks.delete(handle)
      })
    } else {
      this.requestVideoFrameCallback = undefined
      this.cancelVideoFrameCallback = undefined
    }
  }

  setDimensions(width: number, height: number): void {
    this.videoWidth = width
    this.videoHeight = height
  }

  fireNextVideoFrame(): void {
    const next = this.frameCallbacks.entries().next()
    if (next.done) throw new Error("No video frame callback is scheduled")
    const [handle, callback] = next.value
    this.frameCallbacks.delete(handle)
    callback(0, {})
  }

  pendingVideoFrameCallbacks(): number {
    return this.frameCallbacks.size
  }
}

function asVideoElement(video: FakeVideo): HTMLVideoElement {
  return video as unknown as HTMLVideoElement
}

function videoElement(width = 640, height = 480): HTMLVideoElement {
  return asVideoElement(new FakeVideo(width, height))
}

function makeCanvasRecord() {
  const drawImage = vi.fn()
  const getImageData = vi.fn(
    (_x: number, _y: number, width: number, height: number) =>
      ({
        data: new Uint8ClampedArray(),
        width,
        height,
        colorSpace: "srgb",
      }) as ImageData,
  )
  const context = { drawImage, getImageData }
  const getContext = vi.fn(
    () => context as unknown as CanvasRenderingContext2D,
  )
  const element = {
    width: 300,
    height: 150,
    getContext,
  } as unknown as HTMLCanvasElement
  return { element, drawImage, getImageData, getContext }
}

type CanvasRecord = ReturnType<typeof makeCanvasRecord>
const canvases: CanvasRecord[] = []
const createElement = vi.fn((tagName: string) => {
  if (tagName !== "canvas") throw new Error(`Unexpected element: ${tagName}`)
  const record = makeCanvasRecord()
  canvases.push(record)
  return record.element
})

function barcode(text: string): Array<{ text: string }> {
  return [{ text }]
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
  await flushMicrotasks()
}

async function loadDecoder(): Promise<typeof import("@/qr/decode")> {
  return import("@/qr/decode")
}

beforeEach(() => {
  vi.resetModules()
  zxing.prepareZXingModule.mockReset()
  zxing.prepareZXingModule.mockResolvedValue({})
  zxing.purgeZXingModule.mockReset()
  zxing.readBarcodes.mockReset()
  zxing.readBarcodes.mockResolvedValue([])
  getUserMedia.mockReset()
  canvases.splice(0)
  createElement.mockClear()
  vi.stubGlobal("navigator", {
    mediaDevices: { getUserMedia },
  })
  vi.stubGlobal("document", { createElement })
})

afterEach(() => {
  if (vi.isFakeTimers()) vi.clearAllTimers()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("camera scanner lifecycle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("caches one pending reader preparation across scanner starts", async () => {
    const preparation = deferred<unknown>()
    zxing.prepareZXingModule.mockReturnValueOnce(preparation.promise)
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    getUserMedia
      .mockResolvedValueOnce(mediaStream(firstTrack))
      .mockResolvedValueOnce(mediaStream(secondTrack))
    const decoder = await loadDecoder()

    const firstHandle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )
    const secondHandle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).not.toHaveBeenCalled()
    preparation.resolve({})
    await flushMicrotasks()
    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    firstHandle.stop()
    secondHandle.stop()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it("rejects scanning without invoking ZXing when WebAssembly is absent", async () => {
    vi.stubGlobal("WebAssembly", undefined)
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const decoder = await loadDecoder()
    const onError = vi.fn()

    await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      onError,
      { once: false },
    )
    await advance(250)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "playing",
        name: "Error",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(zxing.prepareZXingModule).not.toHaveBeenCalled()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("prepares one reader module with the stable same-origin WASM override", async () => {
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    getUserMedia
      .mockResolvedValueOnce(mediaStream(firstTrack))
      .mockResolvedValueOnce(mediaStream(secondTrack))
    const decoder = await loadDecoder()

    const firstHandle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )
    const preparation = zxing.prepareZXingModule.mock.calls[0]?.[0] as
      | {
          fireImmediately?: boolean
          overrides?: {
            locateFile?: (path: string, scriptDirectory: string) => string
          }
        }
      | undefined
    const locateFile = preparation?.overrides?.locateFile

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(preparation?.fireImmediately).toBe(true)
    expect(locateFile).toBeTypeOf("function")
    const locatedWasm = locateFile?.("zxing_reader.wasm", "https://cdn.invalid/")
    expect(locatedWasm).toBe("/assets/zxing_reader-test-hash.wasm")
    expect(new URL(locatedWasm!, "https://qrypt.test").origin).toBe(
      "https://qrypt.test",
    )
    expect(locateFile?.("reader.data", "/assets/")).toBe("/assets/reader.data")
    expect(zxing.prepareZXingModule.mock.invocationCallOrder[0]).toBeLessThan(
      getUserMedia.mock.invocationCallOrder[0]!,
    )

    const secondHandle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    firstHandle.stop()
    secondHandle.stop()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it("times out a never-settling video.play without starting the scan loop", async () => {
    const playback = deferred<void>()
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      play: () => playback.promise,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const rejection = expect(
      decoder.startQrScan(asVideoElement(fakeVideo), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    expect(fakeVideo.play).toHaveBeenCalledOnce()
    await advance(decoder.CAMERA_START_TIMEOUT_MS)
    await rejection

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquired",
        name: "unknown",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()

    playback.resolve(undefined)
    await flushMicrotasks()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
  })

  it("maps a rejected video.play with acquired-phase diagnostics", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      play: () => Promise.reject(new DOMException("play failed", "NotSupportedError")),
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const decoder = await loadDecoder()

    await expect(
      decoder.startQrScan(asVideoElement(fakeVideo), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquired",
        name: "NotSupportedError",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("keeps a present-but-silent requestVideoFrameCallback on the 200 ms cadence", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(640, 480, {
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const decodeStartedAt: number[] = []
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      return []
    })
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      if (decodeStartedAt.length === 1) {
        setTimeout(() => fakeVideo.fireNextVideoFrame(), 200)
      }
      return []
    })
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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
      zxing.readBarcodes.mockResolvedValueOnce(barcode("OCK1:recovered"))
      const onText = vi.fn()
      const onError = vi.fn()
      const decoder = await loadDecoder()
      const handle = await decoder.startQrScan(
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
      expect(onText).toHaveBeenCalledWith("OCK1:recovered")
      expect(onError).not.toHaveBeenCalled()
      expect(fakeVideo.play.mock.calls.length).toBeGreaterThan(1)
      expect(track.stop).toHaveBeenCalledOnce()
      handle.stop()
    },
  )

  it("reports a silent frame callback and persistent zero-size frame with playing diagnostics", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(0, 0, {
      videoFrameCallbacks: true,
    })
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      onError,
      { once: false },
    )

    await advance(decoder.CAMERA_FRAME_READY_TIMEOUT_MS - 1)
    expect(onError).not.toHaveBeenCalled()
    await advance(1)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "playing",
        name: "IndexSizeError",
        detail: "0x0 rs=2 track=live/unmuted",
      },
    )
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(fakeVideo.cancelVideoFrameCallback).toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("draws into one willReadFrequently canvas downscaled to a 1280px long edge", async () => {
    const track = new FakeTrack()
    const fakeVideo = new FakeVideo(1920, 1080)
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes.mockResolvedValue([])
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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

  it("ignores a decode that resolves after explicit stop", async () => {
    const pending = deferred<Array<{ text: string }>>()
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const onText = vi.fn()
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false },
    )
    await advance(0)

    handle.stop()
    pending.resolve(barcode("OCK1:late"))
    await flushMicrotasks()

    expect(onText).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("ignores a decode that resolves after abort", async () => {
    const pending = deferred<Array<{ text: string }>>()
    const track = new FakeTrack()
    const controller = new AbortController()
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const onText = vi.fn()
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false, signal: controller.signal },
    )
    await advance(0)

    controller.abort()
    pending.resolve(barcode("OCK1:late"))
    await flushMicrotasks()

    expect(onText).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("ignores a decode that resolves after track end", async () => {
    const pending = deferred<Array<{ text: string }>>()
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const onText = vi.fn()
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false },
    )
    await advance(0)

    track.end()
    pending.resolve(barcode("OCK1:late"))
    await flushMicrotasks()

    expect(onText).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "track-ended",
        name: null,
        detail: "640x480 rs=2 track=ended/unmuted",
      },
    )
    expect(track.stop).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("ignores an old decode after a newer attempt has begun", async () => {
    const oldDecode = deferred<Array<{ text: string }>>()
    const oldTrack = new FakeTrack()
    const newTrack = new FakeTrack()
    const oldVideo = new FakeVideo()
    const newVideo = new FakeVideo()
    getUserMedia
      .mockResolvedValueOnce(mediaStream(oldTrack))
      .mockResolvedValueOnce(mediaStream(newTrack))
    zxing.readBarcodes
      .mockReturnValueOnce(oldDecode.promise)
      .mockResolvedValueOnce([])
    const oldText = vi.fn()
    const newText = vi.fn()
    const decoder = await loadDecoder()
    const oldHandle = await decoder.startQrScan(
      asVideoElement(oldVideo),
      oldText,
      vi.fn(),
      { once: false },
    )
    await advance(0)

    const newHandle = await decoder.startQrScan(
      asVideoElement(newVideo),
      newText,
      vi.fn(),
      { once: false },
    )
    oldDecode.resolve(barcode("OCK1:old-late"))
    await flushMicrotasks()
    await advance(0)

    expect(oldText).not.toHaveBeenCalled()
    expect(newText).not.toHaveBeenCalled()
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(asVideoElement(newVideo).srcObject).not.toBeNull()
    oldHandle.stop()
    newHandle.stop()
  })

  it("ignores an old pending decode that resolves after replacement startup times out", async () => {
    const oldDecode = deferred<Array<{ text: string }>>()
    const stalledPlay = deferred<void>()
    const oldTrack = new FakeTrack()
    const replacementTrack = new FakeTrack()
    const replacementVideo = new FakeVideo(640, 480, {
      play: () => stalledPlay.promise,
    })
    getUserMedia
      .mockResolvedValueOnce(mediaStream(oldTrack))
      .mockResolvedValueOnce(mediaStream(replacementTrack))
    zxing.readBarcodes.mockReturnValueOnce(oldDecode.promise)
    const oldText = vi.fn()
    const replacementError = vi.fn()
    const decoder = await loadDecoder()
    const oldHandle = await decoder.startQrScan(
      videoElement(),
      oldText,
      vi.fn(),
      { once: false },
    )
    await advance(0)

    const replacementRejection = expect(
      decoder.startQrScan(
        asVideoElement(replacementVideo),
        vi.fn(),
        replacementError,
        { once: false },
      ),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()
    await advance(decoder.CAMERA_START_TIMEOUT_MS)
    await replacementRejection

    oldDecode.resolve(barcode("OCK1:old-after-timeout"))
    await flushMicrotasks()

    expect(oldText).not.toHaveBeenCalled()
    expect(replacementError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquired",
        name: "unknown",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(replacementTrack.stop).toHaveBeenCalledOnce()
    oldHandle.stop()
  })

  it.each([
    { once: true, expectedTexts: ["OCK1:first"], expectedReads: 1 },
    {
      once: false,
      expectedTexts: ["OCK1:first", "OCK1:second"],
      expectedReads: 2,
    },
  ])(
    "handles two rapid successful results with once=$once",
    async ({ once, expectedTexts, expectedReads }) => {
      const track = new FakeTrack()
      getUserMedia.mockResolvedValue(mediaStream(track))
      zxing.readBarcodes
        .mockResolvedValueOnce(barcode("OCK1:first"))
        .mockResolvedValueOnce(barcode("OCK1:second"))
      const onText = vi.fn()
      const onError = vi.fn()
      const decoder = await loadDecoder()
      const handle = await decoder.startQrScan(
        videoElement(),
        onText,
        onError,
        { once },
      )

      await advance(0)
      await advance(199)
      expect(zxing.readBarcodes).toHaveBeenCalledTimes(1)
      await advance(1)

      expect(zxing.readBarcodes).toHaveBeenCalledTimes(expectedReads)
      expect(onText.mock.calls.map(([text]) => text)).toEqual(expectedTexts)
      expect(onError).not.toHaveBeenCalled()
      expect(track.stop).toHaveBeenCalledTimes(once ? 1 : 0)
      handle.stop()
      expect(track.stop).toHaveBeenCalledOnce()
    },
  )

  it("keeps readBarcodes strictly single-flight", async () => {
    const firstDecode = deferred<Array<{ text: string }>>()
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes
      .mockReturnValueOnce(firstDecode.promise)
      .mockResolvedValueOnce([])
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    await advance(0)
    await advance(10_000)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()

    firstDecode.resolve([])
    await flushMicrotasks()
    await advance(0)
    expect(zxing.readBarcodes).toHaveBeenCalledTimes(2)
    handle.stop()
  })

  it("starts the next decode immediately after a decode lasting longer than 200 ms", async () => {
    const firstDecode = deferred<Array<{ text: string }>>()
    const decodeStartedAt: number[] = []
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes
      .mockImplementationOnce(() => {
        decodeStartedAt.push(Date.now())
        return firstDecode.promise
      })
      .mockImplementationOnce(async () => {
        decodeStartedAt.push(Date.now())
        return []
      })
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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

  it("uses only the timer at a 200 ms cadence when requestVideoFrameCallback is absent", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const decodeStartedAt: number[] = []
    zxing.readBarcodes.mockImplementation(async () => {
      decodeStartedAt.push(Date.now())
      return []
    })
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
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
    "stops with playing diagnostics when readBarcodes $behavior",
    async ({ name, arrange }) => {
      const track = new FakeTrack()
      getUserMedia.mockResolvedValue(mediaStream(track))
      const error = new Error("decoder failed")
      error.name = name
      arrange(error)
      const onError = vi.fn()
      const decoder = await loadDecoder()
      const handle = await decoder.startQrScan(
        videoElement(),
        vi.fn(),
        onError,
        { once: false },
      )

      await advance(0)

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
        {
          phase: "playing",
          name,
          detail: "640x480 rs=2 track=live/unmuted",
        },
      )
      expect(track.stop).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
      handle.stop()
    },
  )

  it("acquires the camera before awaiting a never-settling WASM preparation", async () => {
    const preparation = deferred<unknown>()
    const track = new FakeTrack()
    zxing.prepareZXingModule.mockReturnValueOnce(preparation.promise)
    getUserMedia.mockResolvedValue(mediaStream(track))
    const fakeVideo = new FakeVideo()
    const decoder = await loadDecoder()

    const scanPromise = decoder.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(zxing.prepareZXingModule.mock.invocationCallOrder[0]).toBeLessThan(
      getUserMedia.mock.invocationCallOrder[0]!,
    )

    const handle = await scanPromise
    expect(fakeVideo.play).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()

    handle.stop()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("surfaces WASM preparation failure after acquisition and stops the track", async () => {
    const preparationError = new WebAssembly.CompileError("bad reader module")
    zxing.prepareZXingModule.mockRejectedValueOnce(preparationError)
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const fakeVideo = new FakeVideo()
    const decoder = await loadDecoder()

    const handle = await decoder.startQrScan(
      asVideoElement(fakeVideo),
      vi.fn(),
      onError,
      { once: false },
    )
    await advance(0)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "playing",
        name: "CompileError",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(zxing.purgeZXingModule).toHaveBeenCalledOnce()
    expect(getUserMedia).toHaveBeenCalledOnce()
    expect(fakeVideo.play).toHaveBeenCalledOnce()
    expect(canvases[0]!.drawImage).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    expect(track.readyState).toBe("ended")
    expect(fakeVideo.srcObject).toBeNull()
    expect(vi.getTimerCount()).toBe(0)

    handle.stop()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("handles a preparation rejection after stop without an unhandled rejection", async () => {
    vi.useRealTimers()
    const preparation = deferred<unknown>()
    const preparationError = new WebAssembly.CompileError("late bad reader module")
    const track = new FakeTrack()
    zxing.prepareZXingModule.mockReturnValueOnce(preparation.promise)
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      onError,
      { once: false },
    )

    handle.stop()
    const unhandledRejections: unknown[] = []
    const recordUnhandled = (reason: unknown) => {
      unhandledRejections.push(reason)
    }
    process.on("unhandledRejection", recordUnhandled)
    try {
      preparation.reject(preparationError)
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0)
      })
      expect(unhandledRejections).toEqual([])
    } finally {
      process.off("unhandledRejection", recordUnhandled)
    }

    expect(zxing.purgeZXingModule).toHaveBeenCalledOnce()
    expect(onError).not.toHaveBeenCalled()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
  })

  it("waits for slow WASM preparation only after drawing the first frame", async () => {
    const preparation = deferred<unknown>()
    const track = new FakeTrack()
    zxing.prepareZXingModule.mockReturnValueOnce(preparation.promise)
    getUserMedia.mockResolvedValue(mediaStream(track))
    zxing.readBarcodes.mockResolvedValueOnce(barcode("OCK1:slow-module"))
    const onText = vi.fn()
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      onText,
      onError,
    )

    await advance(0)

    const canvas = canvases[0]!
    expect(canvas.drawImage).toHaveBeenCalledOnce()
    expect(canvas.getImageData).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
    expect(onText).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)

    preparation.resolve({})
    await flushMicrotasks()

    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(canvas.drawImage.mock.invocationCallOrder[0]).toBeLessThan(
      zxing.readBarcodes.mock.invocationCallOrder[0]!,
    )
    expect(onText).toHaveBeenCalledWith("OCK1:slow-module")
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).toHaveBeenCalledOnce()
    handle.stop()
  })

  it("retries a transient acquisition failure and then starts", async () => {
    const track = new FakeTrack()
    getUserMedia
      .mockRejectedValueOnce(new DOMException("camera", "NotReadableError"))
      .mockResolvedValueOnce(mediaStream(track))
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const scanPromise = decoder.startQrScan(
      videoElement(),
      vi.fn(),
      onError,
      { once: false },
    )
    await flushMicrotasks()

    await advance(300)
    const handle = await scanPromise

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    handle.stop()
  })

  it("reports a persistent transient acquisition failure after three retries", async () => {
    getUserMedia.mockRejectedValue(new DOMException("camera", "NotReadableError"))
    const onError = vi.fn()
    const decoder = await loadDecoder()
    const rejection = expect(
      decoder.startQrScan(videoElement(), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    await advance(900)
    await rejection

    expect(getUserMedia).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquiring",
        name: "NotReadableError",
        detail: "640x480 rs=2 track=none",
      },
    )
  })

  it("keeps camera acquisition single-flight across replacement", async () => {
    const firstAcquire = deferred<MediaStream>()
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    let acquisitionsInFlight = 0
    let maximumAcquisitionsInFlight = 0
    getUserMedia
      .mockImplementationOnce(async () => {
        acquisitionsInFlight += 1
        maximumAcquisitionsInFlight = Math.max(
          maximumAcquisitionsInFlight,
          acquisitionsInFlight,
        )
        try {
          return await firstAcquire.promise
        } finally {
          acquisitionsInFlight -= 1
        }
      })
      .mockImplementationOnce(async () => {
        acquisitionsInFlight += 1
        maximumAcquisitionsInFlight = Math.max(
          maximumAcquisitionsInFlight,
          acquisitionsInFlight,
        )
        try {
          return mediaStream(secondTrack)
        } finally {
          acquisitionsInFlight -= 1
        }
      })
    const decoder = await loadDecoder()
    const firstPromise = decoder.startQrScan(videoElement(), vi.fn(), vi.fn())
    const firstRejection = expect(firstPromise).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledOnce()

    const secondPromise = decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledOnce()

    firstAcquire.resolve(mediaStream(firstTrack))
    await flushMicrotasks()
    const secondHandle = await secondPromise
    await firstRejection

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(maximumAcquisitionsInFlight).toBe(1)
    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).not.toHaveBeenCalled()
    secondHandle.stop()
  })

  it("makes explicit close idempotent", async () => {
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(firstTrack, secondTrack))
    const decoder = await loadDecoder()
    const handle = await decoder.startQrScan(
      videoElement(),
      vi.fn(),
      vi.fn(),
      { once: false },
    )

    handle.stop()
    handle.stop()

    expect(firstTrack.stop).toHaveBeenCalledOnce()
    expect(secondTrack.stop).toHaveBeenCalledOnce()
  })

  it("uses visibility restart only to request the stopped UI", async () => {
    const decoder = await loadDecoder()
    let uiMode: "running" | "stopped" = "running"
    if (decoder.shouldRestartQrScanOnVisibility("failed", "visible")) {
      uiMode = "stopped"
    }

    expect(uiMode).toBe("stopped")
    expect(
      decoder.shouldRestartQrScanOnVisibility("track-ended", "visible"),
    ).toBe(true)
    expect(
      decoder.shouldRestartQrScanOnVisibility("failed", "hidden"),
    ).toBe(false)
  })
})

describe("MultipartScanSession", () => {
  it("serializes concurrent add calls on one session", async () => {
    const first = deferred<TransferState>()
    const second = deferred<TransferState>()
    const pending = [first, second]
    let active = 0
    let maximumActive = 0
    const add = vi
      .spyOn(TransferAssembler.prototype, "add")
      .mockImplementation(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const operation = pending.shift()
        try {
          return await operation!.promise
        } finally {
          active -= 1
        }
      })
    const session = new MultipartScanSession(5)

    const firstResult = session.add("OCF2:first")
    const secondResult = session.add("OCF2:second")
    await flushMicrotasks()

    expect(add).toHaveBeenCalledOnce()
    expect(maximumActive).toBe(1)

    first.resolve({ kind: "idle" })
    await expect(firstResult).resolves.toEqual({ kind: "idle" })
    await flushMicrotasks()
    expect(add).toHaveBeenCalledTimes(2)
    expect(maximumActive).toBe(1)

    second.resolve({ kind: "idle" })
    await expect(secondResult).resolves.toEqual({ kind: "idle" })
    expect(maximumActive).toBe(1)
    add.mockRestore()
  })

  it("invalidates queued frames when the session is discarded", async () => {
    const pending = deferred<TransferState>()
    const add = vi
      .spyOn(TransferAssembler.prototype, "add")
      .mockImplementationOnce(() => pending.promise)
    const session = new MultipartScanSession(5)

    const activeResult = session.add("OCF2:active")
    const queuedResult = session.add("OCF2:queued")
    await flushMicrotasks()
    expect(add).toHaveBeenCalledOnce()

    session.discard()
    pending.resolve({ kind: "idle" })

    await expect(activeResult).resolves.toEqual({ kind: "idle" })
    await expect(queuedResult).resolves.toEqual({ kind: "idle" })
    expect(add).toHaveBeenCalledOnce()
    add.mockRestore()
  })
})
