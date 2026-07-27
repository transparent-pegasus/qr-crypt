import { beforeEach, describe, expect, it, vi } from "vitest"

const leaf = vi.hoisted(() => ({
  qrPngBlob: vi.fn(),
  triggerDownload: vi.fn(),
  storeOnlyZip: vi.fn(() => new Blob([new Uint8Array()])),
}))

vi.mock("@/qr/export-image", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/qr/export-image")>()
  return { ...actual, qrPngBlob: leaf.qrPngBlob, triggerDownload: leaf.triggerDownload }
})
vi.mock("@/lib/best-effort-zip", () => ({ storeOnlyZip: leaf.storeOnlyZip }))

function pngBlob(): Blob {
  return new Blob([new Uint8Array([1, 2, 3])])
}

describe("exportQrFramePayloads", () => {
  beforeEach(() => {
    vi.resetModules()
    leaf.qrPngBlob.mockReset()
    leaf.qrPngBlob.mockResolvedValue(pngBlob())
    leaf.triggerDownload.mockReset()
    leaf.storeOnlyZip.mockClear()
  })

  it("does nothing for an empty frame list", async () => {
    const { exportQrFramePayloads } = await import("@/qr/export-frames")

    await exportQrFramePayloads([], { outputName: "empty", size: 512 })

    expect(leaf.qrPngBlob).not.toHaveBeenCalled()
    expect(leaf.triggerDownload).not.toHaveBeenCalled()
  })

  it("downloads a single frame as one png", async () => {
    const { exportQrFramePayloads } = await import("@/qr/export-frames")

    await exportQrFramePayloads([{ frameIndex: 0, payload: "OCF2:only" }], {
      outputName: "one",
      size: 512,
    })

    expect(leaf.triggerDownload).toHaveBeenCalledWith(expect.anything(), "one.png")
    expect(leaf.storeOnlyZip).not.toHaveBeenCalled()
  })

  it("names zip entries from the protocol frame index, not the array position", async () => {
    const { exportQrFramePayloads } = await import("@/qr/export-frames")

    await exportQrFramePayloads(
      [
        { frameIndex: 0, payload: "OCF2:a" },
        { frameIndex: 2, payload: "OCF2:c" },
      ],
      { outputName: "sparse", size: 512 },
    )

    expect(leaf.storeOnlyZip).toHaveBeenCalledWith([
      { name: "frame-01.png", data: expect.any(Uint8Array) },
      { name: "frame-03.png", data: expect.any(Uint8Array) },
    ])
    expect(leaf.triggerDownload).toHaveBeenCalledWith(
      expect.anything(),
      "sparse-frames.zip",
    )
  })

  it("stops before downloading when the signal aborts on entry", async () => {
    const { exportQrFramePayloads } = await import("@/qr/export-frames")
    const controller = new AbortController()
    controller.abort()

    await exportQrFramePayloads(
      [
        { frameIndex: 0, payload: "OCF2:a" },
        { frameIndex: 1, payload: "OCF2:b" },
      ],
      { outputName: "aborted", size: 512, signal: controller.signal },
    )

    expect(leaf.qrPngBlob).not.toHaveBeenCalled()
    expect(leaf.triggerDownload).not.toHaveBeenCalled()
  })

  it("stops mid-loop when the signal aborts while a frame is rendering", async () => {
    const { exportQrFramePayloads } = await import("@/qr/export-frames")
    const controller = new AbortController()
    leaf.qrPngBlob.mockImplementationOnce(async () => {
      controller.abort()
      return pngBlob()
    })

    await exportQrFramePayloads(
      [
        { frameIndex: 0, payload: "OCF2:a" },
        { frameIndex: 1, payload: "OCF2:b" },
      ],
      { outputName: "midway", size: 512, signal: controller.signal },
    )

    expect(leaf.qrPngBlob).toHaveBeenCalledOnce()
    expect(leaf.storeOnlyZip).not.toHaveBeenCalled()
    expect(leaf.triggerDownload).not.toHaveBeenCalled()
  })
})
