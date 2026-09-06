import {
  advance,
  asVideoElement,
  barcode,
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

describe("camera scan orchestration", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("ignores a decode that resolves after explicit stop", async () => {
    const pending = deferred<Array<{ text: string }>>()
    const track = new FakeTrack()
    getUserMedia.mockResolvedValue(mediaStream(track))
    const onText = vi.fn()
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const handle = await cameraScan.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false },
    )
    await advance(0)

    handle.stop()
    pending.resolve(barcode("SCANTEXT:late"))
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
    const onText = vi.fn()
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const handle = await cameraScan.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false, signal: controller.signal },
    )
    await advance(0)

    controller.abort()
    pending.resolve(barcode("SCANTEXT:late"))
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
    const onText = vi.fn()
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockReturnValueOnce(pending.promise)
    const handle = await cameraScan.startQrScan(
      videoElement(),
      onText,
      onError,
      { once: false },
    )
    await advance(0)

    track.end()
    pending.resolve(barcode("SCANTEXT:late"))
    await flushMicrotasks()

    expect(onText).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      "track-ended",
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
    const oldText = vi.fn()
    const newText = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes
      .mockReturnValueOnce(oldDecode.promise)
      .mockResolvedValueOnce([])
    const oldHandle = await cameraScan.startQrScan(
      asVideoElement(oldVideo),
      oldText,
      vi.fn(),
      { once: false },
    )
    await advance(0)

    const newHandle = await cameraScan.startQrScan(
      asVideoElement(newVideo),
      newText,
      vi.fn(),
      { once: false },
    )
    oldDecode.resolve(barcode("SCANTEXT:old-late"))
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

  it("ignores an old pending decode after replacement decode progress times out", async () => {
    const oldDecode = deferred<Array<{ text: string }>>()
    const replacementDecode = deferred<Array<{ text: string }>>()
    const oldTrack = new FakeTrack()
    const replacementTrack = new FakeTrack()
    const replacementVideo = new FakeVideo()
    getUserMedia
      .mockResolvedValueOnce(mediaStream(oldTrack))
      .mockResolvedValueOnce(mediaStream(replacementTrack))
    const oldText = vi.fn()
    const replacementError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes
      .mockReturnValueOnce(oldDecode.promise)
      .mockReturnValueOnce(replacementDecode.promise)
    const oldHandle = await cameraScan.startQrScan(
      videoElement(),
      oldText,
      vi.fn(),
      { once: false },
    )
    await advance(0)

    const replacementHandle = await cameraScan.startQrScan(
      asVideoElement(replacementVideo),
      vi.fn(),
      replacementError,
      { once: false },
    )
    await advance(0)
    await advance(cameraScan.CAMERA_DECODE_PROGRESS_TIMEOUT_MS)

    oldDecode.resolve(barcode("SCANTEXT:old-after-timeout"))
    replacementDecode.resolve([])
    await flushMicrotasks()

    expect(oldText).not.toHaveBeenCalled()
    expect(replacementError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "QR_DECODE_PROGRESS_TIMEOUT" }),
      "failed",
    )
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(replacementTrack.stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
    oldHandle.stop()
    replacementHandle.stop()
  })

  it("ignores an old pending decode that resolves after replacement acquisition times out", async () => {
    const oldDecode = deferred<Array<{ text: string }>>()
    const replacementAcquire = deferred<MediaStream>()
    const oldTrack = new FakeTrack()
    const replacementTrack = new FakeTrack()
    const replacementVideo = new FakeVideo()
    getUserMedia
      .mockResolvedValueOnce(mediaStream(oldTrack))
      .mockReturnValueOnce(replacementAcquire.promise)
    const oldText = vi.fn()
    const replacementError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockReturnValueOnce(oldDecode.promise)
    const oldHandle = await cameraScan.startQrScan(
      videoElement(),
      oldText,
      vi.fn(),
      { once: false },
    )
    await advance(0)

    const replacementRejection = expect(
      cameraScan.startQrScan(
        asVideoElement(replacementVideo),
        vi.fn(),
        replacementError,
        { once: false },
      ),
    ).rejects.toMatchObject({ code: "CAMERA_NOT_AVAILABLE" })
    await flushMicrotasks()
    await advance(cameraScan.CAMERA_START_TIMEOUT_MS)
    await replacementRejection

    oldDecode.resolve(barcode("SCANTEXT:old-after-timeout"))
    await flushMicrotasks()

    expect(oldText).not.toHaveBeenCalled()
    expect(replacementError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      "failed",
    )
    expect(oldTrack.stop).toHaveBeenCalledOnce()
    expect(replacementTrack.stop).not.toHaveBeenCalled()

    replacementAcquire.resolve(mediaStream(replacementTrack))
    await flushMicrotasks()
    expect(replacementTrack.stop).toHaveBeenCalledOnce()
    oldHandle.stop()
  })

  it.each([
    { once: true, expectedTexts: ["SCANTEXT:first"], expectedReads: 1 },
    {
      once: false,
      expectedTexts: ["SCANTEXT:first", "SCANTEXT:second"],
      expectedReads: 2,
    },
  ])(
    "handles two rapid successful results with once=$once",
    async ({ once, expectedTexts, expectedReads }) => {
      const track = new FakeTrack()
      getUserMedia.mockResolvedValue(mediaStream(track))
      const onText = vi.fn()
      const onError = vi.fn()
      const cameraScan = await loadCameraScan()
      zxing.readBarcodes
        .mockResolvedValueOnce(barcode("SCANTEXT:first"))
        .mockResolvedValueOnce(barcode("SCANTEXT:second"))
      const handle = await cameraScan.startQrScan(
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
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes
      .mockReturnValueOnce(firstDecode.promise)
      .mockResolvedValueOnce([])
    const handle = await cameraScan.startQrScan(
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


  it("reports a scanned-payload callback failure as a camera error", async () => {
    getUserMedia.mockResolvedValue(mediaStream(new FakeTrack()))
    const onError = vi.fn()
    const cameraScan = await loadCameraScan()
    zxing.readBarcodes.mockResolvedValue(barcode("SCANTEXT:SENTINEL-SECRET"))

    const handle = await cameraScan.startQrScan(
      videoElement(),
      () => {
        throw new Error("delivery failed for SCANTEXT:SENTINEL-SECRET")
      },
      onError,
      { once: false },
    )
    await advance(0)
    await flushMicrotasks()

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ code: "CAMERA_NOT_AVAILABLE" }),
      "failed",
    )
    handle.stop()
  })
})
