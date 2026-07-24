import {
  ChecksumException,
  FormatException,
  IllegalStateException,
  NotFoundException,
} from "@zxing/library"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface MockResult {
  getText(): string
}

interface MockNamedError {
  name: string
  getKind?(): unknown
}

interface MockControls {
  stop(): void
}

type ScannerCallback = (
  result: MockResult | undefined,
  error: MockNamedError | undefined,
  controls: MockControls,
) => void

const scanner = vi.hoisted(() => ({
  callbacks: [] as ScannerCallback[],
  decodePlans: [] as Array<() => Promise<MockControls>>,
  decode: vi.fn(),
  controlsStop: vi.fn(),
}))

vi.mock("@zxing/browser", () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoElement(
      video: HTMLVideoElement,
      callback: ScannerCallback,
    ): Promise<MockControls> {
      scanner.decode(video)
      scanner.callbacks.push(callback)
      return (
        scanner.decodePlans.shift()?.() ?? Promise.resolve({ stop: scanner.controlsStop })
      )
    }
  },
}))

import {
  CAMERA_FRAME_READY_TIMEOUT_MS,
  CAMERA_START_TIMEOUT_MS,
  shouldRestartQrScanOnVisibility,
  startQrScan,
} from "@/qr/decode"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { TransferAssembler } from "@/qr/multipart/assemble"
import type { TransferState } from "@/qr/multipart/transfer-state"

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
  readyState: MediaStreamTrackState = "live"
  muted = false

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

class FakeVideo extends EventTarget {
  srcObject: MediaStream | null = null
  videoWidth: number
  videoHeight: number
  readyState: number
  readonly play = vi.fn(async () => undefined)

  constructor(width = 640, height = 480, readyState = 2) {
    super()
    this.videoWidth = width
    this.videoHeight = height
    this.readyState = readyState
  }

  setDimensions(width: number, height: number): void {
    this.videoWidth = width
    this.videoHeight = height
  }
}

function videoElement(width = 640, height = 480, readyState = 2): HTMLVideoElement {
  return new FakeVideo(width, height, readyState) as unknown as HTMLVideoElement
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

beforeEach(() => {
  scanner.callbacks.splice(0)
  scanner.decodePlans.splice(0)
  scanner.decode.mockReset()
  scanner.controlsStop.mockReset()
  getUserMedia.mockReset()
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe("camera scanner lifecycle", () => {
  it("emits once, then stops controls and every owned track", async () => {
    const track = new FakeTrack()
    const video = videoElement()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    await startQrScan(video, onText, onError)
    const controls = { stop: scanner.controlsStop }

    scanner.callbacks[0]?.({ getText: () => "OCK1:value" }, undefined, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:second" }, undefined, controls)

    expect(onText).toHaveBeenCalledTimes(1)
    expect(onText).toHaveBeenCalledWith("OCK1:value")
    expect(onError).not.toHaveBeenCalled()
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })

  it("makes explicit close stop idempotent", async () => {
    const track = new FakeTrack()
    const video = videoElement()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const handle = await startQrScan(video, vi.fn(), vi.fn(), { once: false })

    handle.stop()
    handle.stop()

    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it("keeps scanning for transient decode misses", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const handle = await startQrScan(videoElement(), vi.fn(), onError)

    scanner.callbacks[0]?.(
      undefined,
      { name: "NotFoundException" },
      { stop: scanner.controlsStop },
    )

    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()
    handle.stop()
  })

  it("keeps scanning after a minified NotFoundException and emits a later result once", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    await startQrScan(videoElement(), onText, onError)
    const controls = { stop: scanner.controlsStop }
    const error = new NotFoundException()
    Object.defineProperty(error, "name", { value: "t" })

    scanner.callbacks[0]?.(undefined, error, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:value" }, undefined, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:second" }, undefined, controls)

    expect(onError).not.toHaveBeenCalled()
    expect(onText).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("OCK1:value")
  })

  it.each([
    ["ChecksumException", () => new ChecksumException()],
    ["FormatException", () => new FormatException()],
  ])("keeps scanning after a minified %s", async (_kind, makeError) => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    await startQrScan(videoElement(), onText, onError)
    const controls = { stop: scanner.controlsStop }
    const error = makeError()
    Object.defineProperty(error, "name", { value: "t" })

    scanner.callbacks[0]?.(undefined, error, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:value" }, undefined, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:second" }, undefined, controls)

    expect(onError).not.toHaveBeenCalled()
    expect(onText).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("OCK1:value")
  })

  it("keeps scanning when getKind identifies a retryable minified error", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    await startQrScan(videoElement(), onText, onError)
    const controls = { stop: scanner.controlsStop }

    scanner.callbacks[0]?.(
      undefined,
      { name: "t", getKind: () => "NotFoundException" },
      controls,
    )
    scanner.callbacks[0]?.({ getText: () => "OCK1:value" }, undefined, controls)
    scanner.callbacks[0]?.({ getText: () => "OCK1:second" }, undefined, controls)

    expect(onError).not.toHaveBeenCalled()
    expect(onText).toHaveBeenCalledOnce()
    expect(onText).toHaveBeenCalledWith("OCK1:value")
  })

  it.each([
    [
      "a minified IllegalStateException instance",
      () => {
        const error = new IllegalStateException()
        Object.defineProperty(error, "name", { value: "t" })
        return error
      },
    ],
    [
      "a non-retryable getKind value",
      () => ({ name: "t", getKind: () => "IllegalStateException" }),
    ],
    [
      "a throwing getKind",
      () => ({
        name: "t",
        getKind: () => {
          throw new Error("x")
        },
      }),
    ],
  ])("treats %s as a fatal decode error", async (_case, makeError) => {
    const track = new FakeTrack()
    const video = videoElement()
    const controls = { stop: vi.fn() }
    scanner.decodePlans.push(() => Promise.resolve(controls))
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const handle = await startQrScan(video, vi.fn(), onError)

    scanner.callbacks[0]?.(undefined, makeError(), controls)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CAMERA_NOT_AVAILABLE",
      }),
      {
        phase: "playing",
        name: "t",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it("preserves a safe unfamiliar error name without exposing it as the user message", async () => {
    const track = new FakeTrack()
    const video = videoElement()
    const controls = { stop: vi.fn() }
    scanner.decodePlans.push(() => Promise.resolve(controls))
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const handle = await startQrScan(video, vi.fn(), onError)

    scanner.callbacks[0]?.(undefined, { name: "CanvasFrameError" }, controls)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CAMERA_NOT_AVAILABLE",
      }),
      {
        phase: "playing",
        name: "CanvasFrameError",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it.each(["IndexSizeError", "InvalidStateError"])(
    "keeps a live zero-size %s transient and resumes after dimensions recover",
    async (errorName) => {
      vi.useFakeTimers()
      const track = new FakeTrack({ muted: true })
      const fakeVideo = new FakeVideo(0, 0, 2)
      const video = fakeVideo as unknown as HTMLVideoElement
      const stalledControls = { stop: vi.fn() }
      const recoveredControls = { stop: vi.fn() }
      scanner.decodePlans.push(
        () => Promise.resolve(stalledControls),
        () => Promise.resolve(recoveredControls),
      )
      getUserMedia.mockResolvedValue(mediaStream(track))
      const onText = vi.fn()
      const onError = vi.fn()
      const handle = await startQrScan(video, onText, onError)

      scanner.callbacks[0]?.(undefined, { name: errorName }, stalledControls)

      expect(onError).not.toHaveBeenCalled()
      expect(track.stop).not.toHaveBeenCalled()
      expect(stalledControls.stop).toHaveBeenCalledTimes(1)

      fakeVideo.setDimensions(1280, 720)
      track.unmute()
      fakeVideo.dispatchEvent(new Event("resize"))
      fakeVideo.dispatchEvent(new Event("loadedmetadata"))
      await vi.advanceTimersByTimeAsync(0)
      await flushMicrotasks()

      expect(scanner.decode).toHaveBeenCalledTimes(2)
      scanner.callbacks[1]?.(
        { getText: () => "OCK1:recovered" },
        undefined,
        recoveredControls,
      )

      expect(onText).toHaveBeenCalledWith("OCK1:recovered")
      expect(onError).not.toHaveBeenCalled()
      expect(fakeVideo.play).toHaveBeenCalled()
      expect(recoveredControls.stop).toHaveBeenCalledTimes(1)
      expect(track.stop).toHaveBeenCalledTimes(1)
      handle.stop()
    },
  )

  it("fails a live stream only after zero-size frames persist with detailed diagnostics", async () => {
    vi.useFakeTimers()
    const track = new FakeTrack({ muted: true })
    const fakeVideo = new FakeVideo(0, 0, 2)
    const controls = { stop: vi.fn() }
    scanner.decodePlans.push(() => Promise.resolve(controls))
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const handle = await startQrScan(
      fakeVideo as unknown as HTMLVideoElement,
      vi.fn(),
      onError,
    )

    scanner.callbacks[0]?.(undefined, { name: "IndexSizeError" }, controls)
    await vi.advanceTimersByTimeAsync(CAMERA_FRAME_READY_TIMEOUT_MS - 1)
    expect(onError).not.toHaveBeenCalled()
    expect(track.stop).not.toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(1)

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "CAMERA_NOT_AVAILABLE",
      }),
      {
        phase: "playing",
        name: "IndexSizeError",
        detail: "0x0 rs=2 track=live/muted",
      },
    )
    expect(controls.stop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    handle.stop()
  })

  it("maps an acquisition NotAllowedError and reports its diagnostic", async () => {
    const video = videoElement()
    getUserMedia.mockRejectedValue(new DOMException("camera", "NotAllowedError"))
    const onError = vi.fn()

    await expect(startQrScan(video, vi.fn(), onError)).rejects.toMatchObject({
      code: "CAMERA_PERMISSION_DENIED",
    })

    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_PERMISSION_DENIED" }),
      {
        phase: "acquiring",
        name: "NotAllowedError",
        detail: "640x480 rs=2 track=none",
      },
    )
  })

  it("retries a transient NotReadableError and resolves without an error", async () => {
    vi.useFakeTimers()
    const track = new FakeTrack()
    getUserMedia
      .mockRejectedValueOnce(new DOMException("camera", "NotReadableError"))
      .mockResolvedValueOnce(mediaStream(track))
    const onError = vi.fn()
    const scanPromise = startQrScan(videoElement(), vi.fn(), onError)

    await vi.advanceTimersByTimeAsync(300)

    const handle = await scanPromise
    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(onError).not.toHaveBeenCalled()
    handle.stop()
  })

  it("rejects a persistent NotReadableError after three retries", async () => {
    vi.useFakeTimers()
    getUserMedia.mockRejectedValue(new DOMException("camera", "NotReadableError"))
    const onError = vi.fn()
    const rejection = expect(
      startQrScan(videoElement(), vi.fn(), onError),
    ).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })

    await vi.advanceTimersByTimeAsync(900)

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

  it("does not acquire again when aborted during retry backoff", async () => {
    vi.useFakeTimers()
    getUserMedia.mockRejectedValueOnce(new DOMException("camera", "AbortError"))
    const controller = new AbortController()
    const rejection = expect(
      startQrScan(videoElement(), vi.fn(), vi.fn(), { signal: controller.signal }),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    controller.abort()
    await vi.advanceTimersByTimeAsync(300)

    await rejection
    expect(getUserMedia).toHaveBeenCalledTimes(1)
  })

  it("keeps acquisition single-flight when restarted before the first promise settles", async () => {
    const firstAcquire = deferred<MediaStream>()
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    const firstStream = mediaStream(firstTrack)
    const secondStream = mediaStream(secondTrack)
    const video = videoElement()
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
          return secondStream
        } finally {
          acquisitionsInFlight -= 1
        }
      })

    const firstError = vi.fn()
    const firstPromise = startQrScan(video, vi.fn(), firstError)
    const firstRejection = expect(firstPromise).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    const secondPromise = startQrScan(video, vi.fn(), vi.fn())
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledTimes(1)

    firstAcquire.resolve(firstStream)
    await flushMicrotasks()
    const secondHandle = await secondPromise
    await firstRejection

    expect(getUserMedia).toHaveBeenCalledTimes(2)
    expect(maximumAcquisitionsInFlight).toBe(1)
    expect(firstError).not.toHaveBeenCalled()
    expect(firstTrack.stop).toHaveBeenCalledTimes(1)
    expect(secondTrack.stop).not.toHaveBeenCalled()
    expect(video.srcObject).toBe(secondStream)
    secondHandle.stop()
  })

  it("uses the visibility predicate only to request the stopped UI", () => {
    let uiMode: "running" | "stopped" = "running"
    if (shouldRestartQrScanOnVisibility("failed", "visible")) {
      uiMode = "stopped"
    }

    expect(uiMode).toBe("stopped")
    expect(shouldRestartQrScanOnVisibility("track-ended", "visible")).toBe(true)
    expect(shouldRestartQrScanOnVisibility("failed", "hidden")).toBe(false)
  })

  it("does not let an old reverse-order decoder completion stop the new stream", async () => {
    const oldDecode = deferred<MockControls>()
    const newDecode = deferred<MockControls>()
    const oldControlsStop = vi.fn()
    const newControlsStop = vi.fn()
    scanner.decodePlans.push(
      () => oldDecode.promise,
      () => newDecode.promise,
    )

    const oldTrack = new FakeTrack()
    const newTrack = new FakeTrack()
    const oldStream = mediaStream(oldTrack)
    const newStream = mediaStream(newTrack)
    getUserMedia.mockResolvedValueOnce(oldStream).mockResolvedValueOnce(newStream)
    const video = videoElement()

    const oldPromise = startQrScan(video, vi.fn(), vi.fn())
    const oldRejection = expect(oldPromise).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })
    await flushMicrotasks()
    expect(scanner.decode).toHaveBeenCalledTimes(1)

    const newPromise = startQrScan(video, vi.fn(), vi.fn())
    await flushMicrotasks()
    expect(scanner.decode).toHaveBeenCalledTimes(2)
    newDecode.resolve({ stop: newControlsStop })
    const newHandle = await newPromise
    expect(video.srcObject).toBe(newStream)

    oldDecode.resolve({ stop: oldControlsStop })
    await oldRejection
    await flushMicrotasks()

    expect(oldControlsStop).toHaveBeenCalledTimes(1)
    expect(oldTrack.stop).toHaveBeenCalledTimes(1)
    expect(newTrack.stop).not.toHaveBeenCalled()
    expect(video.srcObject).toBe(newStream)
    newHandle.stop()
    expect(newControlsStop).toHaveBeenCalledTimes(1)
    expect(newTrack.stop).toHaveBeenCalledTimes(1)
  })

  it("stops every owned track when an unmount aborts the attempt", async () => {
    const firstTrack = new FakeTrack()
    const secondTrack = new FakeTrack()
    const video = videoElement()
    getUserMedia.mockResolvedValue(mediaStream(firstTrack, secondTrack))
    const controller = new AbortController()
    const handle = await startQrScan(video, vi.fn(), vi.fn(), {
      once: false,
      signal: controller.signal,
    })

    controller.abort()
    handle.stop()

    expect(firstTrack.stop).toHaveBeenCalledTimes(1)
    expect(secondTrack.stop).toHaveBeenCalledTimes(1)
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })

  it("times out an unresolved acquisition with an unknown acquiring diagnostic", async () => {
    vi.useFakeTimers()
    const acquisition = deferred<MediaStream>()
    const lateTrack = new FakeTrack()
    getUserMedia.mockReturnValue(acquisition.promise)
    const onError = vi.fn()
    const rejection = expect(
      startQrScan(videoElement(), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(CAMERA_START_TIMEOUT_MS)
    await rejection

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquiring",
        name: "unknown",
        detail: "640x480 rs=2 track=none",
      },
    )

    acquisition.resolve(mediaStream(lateTrack))
    await flushMicrotasks()
    expect(lateTrack.stop).toHaveBeenCalledTimes(1)
  })

  it("maps a non-Error false playback rejection to unknown", async () => {
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    scanner.decodePlans.push(() => Promise.reject(false))
    const onError = vi.fn()

    await expect(startQrScan(videoElement(), vi.fn(), onError)).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquired",
        name: "unknown",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(track.stop).toHaveBeenCalledTimes(1)
  })

  it("times out stalled playback after acquisition without leaking late controls", async () => {
    vi.useFakeTimers()
    const track = new FakeTrack()
    const stream = mediaStream(track)
    const playback = deferred<MockControls>()
    const lateControlsStop = vi.fn()
    getUserMedia.mockResolvedValue(stream)
    scanner.decodePlans.push(() => playback.promise)
    const onError = vi.fn()
    const rejection = expect(
      startQrScan(videoElement(), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    await vi.advanceTimersByTimeAsync(CAMERA_START_TIMEOUT_MS)
    await rejection

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "acquired",
        name: "unknown",
        detail: "640x480 rs=2 track=live/unmuted",
      },
    )
    expect(track.stop).toHaveBeenCalledTimes(1)

    playback.resolve({ stop: lateControlsStop })
    await flushMicrotasks()
    expect(lateControlsStop).toHaveBeenCalledTimes(1)
  })

  it("reports track ended separately and stops its attempt", async () => {
    const track = new FakeTrack()
    const video = videoElement()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onError = vi.fn()
    const handle = await startQrScan(video, vi.fn(), onError, { once: false })

    track.end()
    handle.stop()

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      {
        phase: "track-ended",
        name: null,
        detail: "640x480 rs=2 track=ended/unmuted",
      },
    )
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
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
