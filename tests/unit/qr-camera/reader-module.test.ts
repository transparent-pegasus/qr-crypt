import {
  barcode,
  deferred,
  FakeTrack,
  flushMicrotasks,
  getUserMedia,
  loadColdDecoder,
  loadDecoder,
  mediaStream,
  videoElement,
  zxingFakes,
} from "./scanner-harness"
import { beforeEach, describe, expect, it, vi } from "vitest"

const zxing = zxingFakes()

describe("reader module readiness and latched warm failures", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it("reaches ready only after an empty reader probe returns", async () => {
    const probe = deferred<Array<{ text: string }>>()
    zxing.readBarcodes.mockReturnValueOnce(probe.promise)
    const decoder = await loadColdDecoder()
    const warm = decoder.warmQrReader()
    const ready = vi.fn()
    void warm.then(ready)

    await flushMicrotasks()

    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(decoder.readerModuleState()).toBe("preparing")
    expect(ready).not.toHaveBeenCalled()

    probe.resolve([])
    await expect(warm).resolves.toBeUndefined()

    expect(decoder.readerModuleState()).toBe("ready")
    expect(ready).toHaveBeenCalledOnce()
  })

  it("accepts a reader probe hit as successful readiness", async () => {
    zxing.readBarcodes.mockResolvedValueOnce(barcode("probe-control-hit"))
    const decoder = await loadColdDecoder()

    await expect(decoder.warmQrReader()).resolves.toBeUndefined()

    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(decoder.readerModuleState()).toBe("ready")
  })

  it("latches a rejected reader probe for every later warm call", async () => {
    const failure = new Error("reader probe failed")
    zxing.readBarcodes.mockRejectedValueOnce(failure)
    const decoder = await loadColdDecoder()

    const firstWarm = decoder.warmQrReader()
    await expect(firstWarm).rejects.toBe(failure)
    expect(decoder.readerModuleState()).toBe("failed")
    expect(zxing.purgeZXingModule).toHaveBeenCalledOnce()

    const secondWarm = decoder.warmQrReader()
    expect(secondWarm).toBe(firstWarm)
    await expect(secondWarm).rejects.toBe(failure)

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
  })

  it("does not probe when reader module preparation rejects", async () => {
    const failure = new WebAssembly.CompileError("reader preparation failed")
    zxing.prepareZXingModule.mockRejectedValueOnce(failure)
    const decoder = await loadColdDecoder()

    await expect(decoder.warmQrReader()).rejects.toBe(failure)

    expect(decoder.readerModuleState()).toBe("failed")
    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()

    // A fresh module instance is the positive control: only preparation success probes.
    vi.resetModules()
    const freshDecoder = await loadColdDecoder()
    await expect(freshDecoder.warmQrReader()).resolves.toBeUndefined()

    expect(zxing.prepareZXingModule).toHaveBeenCalledTimes(2)
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()
    expect(freshDecoder.readerModuleState()).toBe("ready")
  })

  it("shares one reader probe across concurrent warm calls", async () => {
    const probe = deferred<Array<{ text: string }>>()
    zxing.readBarcodes.mockReturnValueOnce(probe.promise)
    const decoder = await loadColdDecoder()

    const firstWarm = decoder.warmQrReader()
    const secondWarm = decoder.warmQrReader()

    expect(secondWarm).toBe(firstWarm)
    await flushMicrotasks()
    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(zxing.readBarcodes).toHaveBeenCalledOnce()

    probe.resolve([])
    await Promise.all([firstWarm, secondWarm])
    expect(decoder.readerModuleState()).toBe("ready")
  })

  it("fails closed before camera acquisition while the reader is cold", async () => {
    const decoder = await loadColdDecoder()

    await expect(
      decoder.startQrScan(videoElement(), vi.fn(), vi.fn(), { once: false }),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "QR_READER_BLOCKED",
    })

    expect(zxing.prepareZXingModule).not.toHaveBeenCalled()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
  })

  it("fails closed before camera acquisition while reader preparation is pending", async () => {
    const preparation = deferred<unknown>()
    zxing.prepareZXingModule.mockReturnValueOnce(preparation.promise)
    const decoder = await loadColdDecoder()
    const warm = decoder.warmQrReader()

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(decoder.readerModuleState()).toBe("preparing")
    await expect(
      decoder.startQrScan(videoElement(), vi.fn(), vi.fn(), { once: false }),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "QR_READER_BLOCKED",
    })
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()

    preparation.resolve({})
    await warm
    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
  })

  it("fails closed after a latched warm failure without reaching the CDN-capable reader path", async () => {
    const failure = new WebAssembly.CompileError("reader warm failed")
    zxing.prepareZXingModule.mockRejectedValueOnce(failure)
    const decoder = await loadColdDecoder()

    await expect(decoder.warmQrReader()).rejects.toBe(failure)
    expect(decoder.readerModuleState()).toBe("failed")
    expect(zxing.purgeZXingModule).toHaveBeenCalledOnce()

    await expect(
      decoder.startQrScan(videoElement(), vi.fn(), vi.fn(), { once: false }),
    ).rejects.toMatchObject({
      name: "AppError",
      code: "QR_READER_BLOCKED",
    })

    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(getUserMedia).not.toHaveBeenCalled()
    expect(zxing.readBarcodes).not.toHaveBeenCalled()
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


  it("latches a synchronous preparation throw for every later warm call", async () => {
    const failure = new WebAssembly.CompileError("synchronous reader failure")
    zxing.prepareZXingModule
      .mockImplementationOnce(() => {
        throw failure
      })
      .mockResolvedValueOnce({})
    const decoder = await loadColdDecoder()

    const firstWarm = decoder.warmQrReader()
    const secondWarm = decoder.warmQrReader()

    expect(secondWarm).toBe(firstWarm)
    await expect(firstWarm).rejects.toBe(failure)
    await expect(secondWarm).rejects.toBe(failure)
    expect(zxing.prepareZXingModule).toHaveBeenCalledOnce()
    expect(zxing.purgeZXingModule).toHaveBeenCalledOnce()
    expect(decoder.readerModuleState()).toBe("failed")
    expect(getUserMedia).not.toHaveBeenCalled()
  })

  it("latches the missing WebAssembly API branch for every warm call", async () => {
    vi.stubGlobal("WebAssembly", undefined)
    const decoder = await loadColdDecoder()

    const firstWarm = decoder.warmQrReader()
    const secondWarm = decoder.warmQrReader()

    expect(secondWarm).toBe(firstWarm)
    await expect(firstWarm).rejects.toThrow(
      "WebAssembly is unavailable for the QR reader",
    )
    await expect(secondWarm).rejects.toThrow(
      "WebAssembly is unavailable for the QR reader",
    )
    expect(zxing.prepareZXingModule).not.toHaveBeenCalled()
    expect(decoder.readerModuleState()).toBe("failed")
    expect(getUserMedia).not.toHaveBeenCalled()
  })
})
