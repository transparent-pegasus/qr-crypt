import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

interface MockResult {
  getText(): string
}

interface MockNamedError {
  name: string
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
  CAMERA_START_TIMEOUT_MS,
  shouldRestartQrScanOnVisibility,
  startQrScan,
  type CameraScanState,
} from "@/qr/decode"

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

class FakeTrack {
  readyState: MediaStreamTrackState = "live"
  readonly stop = vi.fn(() => {
    this.readyState = "ended"
  })
  readonly #endedListeners = new Set<EventListener>()

  addEventListener(type: string, listener: EventListener): void {
    if (type === "ended") this.#endedListeners.add(listener)
  }

  removeEventListener(type: string, listener: EventListener): void {
    if (type === "ended") this.#endedListeners.delete(listener)
  }

  end(): void {
    this.readyState = "ended"
    const event = new Event("ended")
    for (const listener of this.#endedListeners) listener(event)
  }
}

class FakeMediaStream {
  constructor(readonly tracks: FakeTrack[]) {}

  getTracks(): FakeTrack[] {
    return this.tracks
  }
}

const getUserMedia = vi.fn<
  (constraints: MediaStreamConstraints) => Promise<MediaStream>
>()

function mediaStream(...tracks: FakeTrack[]): MediaStream {
  return new FakeMediaStream(tracks) as unknown as MediaStream
}

function videoElement(): HTMLVideoElement {
  return { srcObject: null } as unknown as HTMLVideoElement
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
      { phase: "acquiring", name: "NotAllowedError" },
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
      { phase: "acquiring", name: "NotReadableError" },
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

  it("ignores repeated visible events once a failed attempt starts restarting", () => {
    let state: CameraScanState = "failed"
    let restarts = 0

    for (let index = 0; index < 3; index += 1) {
      if (shouldRestartQrScanOnVisibility(state, "visible")) {
        state = "acquiring"
        restarts += 1
      }
    }

    expect(restarts).toBe(1)
    expect(shouldRestartQrScanOnVisibility("track-ended", "visible")).toBe(true)
    expect(shouldRestartQrScanOnVisibility("failed", "hidden")).toBe(false)
  })

  it("does not let an old reverse-order decoder completion stop the new stream", async () => {
    const oldDecode = deferred<MockControls>()
    const newDecode = deferred<MockControls>()
    const oldControlsStop = vi.fn()
    const newControlsStop = vi.fn()
    scanner.decodePlans.push(() => oldDecode.promise, () => newDecode.promise)

    const oldTrack = new FakeTrack()
    const newTrack = new FakeTrack()
    const oldStream = mediaStream(oldTrack)
    const newStream = mediaStream(newTrack)
    getUserMedia
      .mockResolvedValueOnce(oldStream)
      .mockResolvedValueOnce(newStream)
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
      { phase: "acquiring", name: "unknown" },
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
      { phase: "acquired", name: "unknown" },
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
      { phase: "acquired", name: "unknown" },
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
      { phase: "track-ended", name: null },
    )
    expect(scanner.controlsStop).toHaveBeenCalledTimes(1)
    expect(track.stop).toHaveBeenCalledTimes(1)
    expect(video.srcObject).toBeNull()
  })
})
