import {
  advance,
  deferred,
  FakeTrack,
  flushMicrotasks,
  getUserMedia,
  loadCameraScan,
  mediaStream,
  videoElement,
} from "./scanner-harness"
import { beforeEach, describe, expect, it, vi } from "vitest"

describe("camera acquisition", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("retries a transient acquisition failure and then starts", async () => {
    const track = new FakeTrack()
    getUserMedia
      .mockRejectedValueOnce(new DOMException("camera", "NotReadableError"))
      .mockResolvedValueOnce(mediaStream(track))
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    const scanPromise = cameraScan.startQrScan(
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
    const cameraScan = await loadCameraScan()
    const rejection = expect(
      cameraScan.startQrScan(videoElement(), vi.fn(), onError),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()

    await advance(900)
    await rejection

    expect(getUserMedia).toHaveBeenCalledTimes(4)
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      "failed",
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
    const cameraScan = await loadCameraScan()
    const firstPromise = cameraScan.startQrScan(videoElement(), vi.fn(), vi.fn())
    const firstRejection = expect(firstPromise).rejects.toMatchObject({
      code: "CAMERA_NOT_AVAILABLE",
    })
    await flushMicrotasks()
    expect(getUserMedia).toHaveBeenCalledOnce()

    const secondPromise = cameraScan.startQrScan(
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
    const cameraScan = await loadCameraScan()
    const handle = await cameraScan.startQrScan(
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
    const cameraScan = await loadCameraScan()
    expect(
      cameraScan.shouldRestartQrScanOnVisibility("failed", "visible"),
    ).toBe(true)
    expect(
      cameraScan.shouldRestartQrScanOnVisibility("track-ended", "visible"),
    ).toBe(true)
    expect(
      cameraScan.shouldRestartQrScanOnVisibility("failed", "hidden"),
    ).toBe(false)
  })
})
