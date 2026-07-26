import "./helpers/module-mocks"
import {
  act,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { AppError } from "@/crypto/errors"
import { useFrameSplit } from "@/hooks/use-frame-split"
import type { QrFrameV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import {
  encodeFrameToPayload,
  qrPngBlob,
  renderQrDataUrl,
  sanitizeQrFileName,
  splitIntoFrames,
  triggerDownload,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

const defaultQrMaxFrames = env.qrMaxFrames

function frame(
  frameIndex: number,
  frameCount: number,
  {
    transfer = 0,
    totalByteLength = frameCount,
  }: { transfer?: number; totalByteLength?: number } = {},
): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16).fill(transfer),
    artifactType: "pq-message",
    frameIndex,
    frameCount,
    totalByteLength,
    payloadSha256: new Uint8Array(32),
    chunk: Uint8Array.of(frameIndex),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe("AnimatedQrFrames", () => {
  beforeEach(resetUi)
  afterEach(() => {
    vi.useRealTimers()
    env.qrMaxFrames = defaultQrMaxFrames
    resetUi()
  })

  it("shows one-based English missing-frame positions", () => {
    render(
      <AnimatedQrFrames
        frames={[frame(0, 3), frame(2, 3)]}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )

    expect(
      screen.getByText(
        "Missing frames: frame 2. Recovery is not possible while frames are missing.",
      ),
    ).toBeInTheDocument()
  })

  it("shows the density-clamp notice only when the automatic profile raises it", () => {
    const { rerender } = render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={2_000}
        outputName="test"
      />,
    )

    expect(
      screen.queryByText("Frame density was raised so this transfer fits."),
    ).toBeNull()
    rerender(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={2_000}
        densityRaised
        outputName="test"
      />,
    )
    expect(
      screen.getByText("Frame density was raised so this transfer fits."),
    ).toHaveAttribute("role", "status")
  })

  it("presents every slow-rendered frame in order without blanking or skipping", async () => {
    vi.useFakeTimers()
    const slowRenders = [
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
      deferred<string>(),
    ]
    for (const slowRender of slowRenders) {
      renderQrDataUrl.mockImplementationOnce(() => slowRender.promise)
    }
    const frames = [frame(0, 3), frame(1, 3), frame(2, 3)]
    const payloads = frames.map(encodeFrameToPayload)
    render(
      <AnimatedQrFrames
        frames={frames}
        frameIntervalMs={200}
        outputName="slow-render"
      />,
    )

    expect(renderQrDataUrl).toHaveBeenCalledOnce()
    expect(renderQrDataUrl).toHaveBeenLastCalledWith(
      payloads[0],
      expect.any(Object),
    )

    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(renderQrDataUrl).toHaveBeenCalledOnce()

    const firstDataUrl = "data:image/png;base64,Zmlyc3Q="
    await act(async () => {
      slowRenders[0]!.resolve(firstDataUrl)
      await slowRenders[0]!.promise
      await Promise.resolve()
    })
    expect(screen.getByRole("img")).toHaveAttribute("src", firstDataUrl)
    expect(screen.queryByText("Generating the QR code…")).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(renderQrDataUrl).toHaveBeenCalledTimes(2)
    expect(renderQrDataUrl).toHaveBeenLastCalledWith(
      payloads[1],
      expect.any(Object),
    )
    expect(screen.getByText("2 / 3")).toBeInTheDocument()
    expect(screen.getByRole("img")).toHaveAttribute("src", firstDataUrl)
    expect(screen.queryByText("Generating the QR code…")).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(renderQrDataUrl).toHaveBeenCalledTimes(2)

    const secondDataUrl = "data:image/png;base64,c2Vjb25k"
    await act(async () => {
      slowRenders[1]!.resolve(secondDataUrl)
      await slowRenders[1]!.promise
      await Promise.resolve()
    })
    expect(screen.getByRole("img")).toHaveAttribute("src", secondDataUrl)

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(renderQrDataUrl).toHaveBeenCalledTimes(3)
    expect(renderQrDataUrl).toHaveBeenLastCalledWith(
      payloads[2],
      expect.any(Object),
    )
    expect(screen.getByRole("img")).toHaveAttribute("src", secondDataUrl)
    expect(screen.queryByText("Generating the QR code…")).toBeNull()

    await act(async () => {
      vi.advanceTimersByTime(500)
    })
    expect(renderQrDataUrl).toHaveBeenCalledTimes(3)

    const thirdDataUrl = "data:image/png;base64,dGhpcmQ="
    await act(async () => {
      slowRenders[2]!.resolve(thirdDataUrl)
      await slowRenders[2]!.promise
      await Promise.resolve()
    })
    expect(screen.getByRole("img")).toHaveAttribute("src", thirdDataUrl)

    await act(async () => {
      vi.advanceTimersByTime(200)
      await Promise.resolve()
    })
    expect(renderQrDataUrl.mock.calls.slice(0, 4).map(([payload]) => payload)).toEqual(
      [payloads[0], payloads[1], payloads[2], payloads[0]],
    )
    expect(screen.getByRole("img")).toHaveAttribute("src", thirdDataUrl)
    expect(screen.queryByText("Generating the QR code…")).toBeNull()
  })

  it("resets to frame one when a same-length transfer generation replaces the frames", async () => {
    const { rerender } = render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("2 / 2")).toBeInTheDocument()

    rerender(
      <AnimatedQrFrames
        frames={[frame(0, 2, { transfer: 1 }), frame(1, 2, { transfer: 1 })]}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument())
  })

  it("downloads one complete frame as one PNG and has no SVG affordance", async () => {
    const png = new Blob(["single-png"], { type: "image/png" })
    qrPngBlob.mockResolvedValueOnce(png)
    render(
      <AnimatedQrFrames
        frames={[frame(0, 1)]}
        frameIntervalMs={1_000}
        outputName="single"
      />,
    )

    const download = screen.getByRole("button", { name: "Download" })
    expect(screen.getAllByRole("button", { name: "Download" })).toHaveLength(1)
    expect(screen.queryByRole("button", { name: /SVG/i })).toBeNull()
    fireEvent.click(download)

    await waitFor(() =>
      expect(triggerDownload).toHaveBeenCalledWith(png, "single.png"),
    )
    expect(qrPngBlob).toHaveBeenCalledOnce()
  })

  it("renders ZIP entries serially and includes every multi-frame PNG", async () => {
    const firstBytes = deferred<ArrayBuffer>()
    const firstArrayBuffer = vi.fn(() => firstBytes.promise)
    const firstBlob = { arrayBuffer: firstArrayBuffer } as unknown as Blob
    const secondBlob = new Blob([Uint8Array.of(2)], { type: "image/png" })
    qrPngBlob
      .mockResolvedValueOnce(firstBlob)
      .mockResolvedValueOnce(secondBlob)
    render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={1_000}
        outputName="multiple"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Download" }))
    await waitFor(() => expect(firstArrayBuffer).toHaveBeenCalledOnce())
    expect(qrPngBlob).toHaveBeenCalledOnce()
    expect(triggerDownload).not.toHaveBeenCalled()

    firstBytes.resolve(Uint8Array.of(1).buffer)
    await waitFor(() => expect(qrPngBlob).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(triggerDownload).toHaveBeenCalledOnce())

    const [archive, name] = triggerDownload.mock.calls[0]!
    expect(name).toBe("multiple-frames.zip")
    expect(archive).toBeInstanceOf(Blob)
    expect((archive as Blob).type).toBe("application/zip")
    const archiveText = new TextDecoder().decode(
      await (archive as Blob).arrayBuffer(),
    )
    expect(archiveText).toContain("frame-01.png")
    expect(archiveText).toContain("frame-02.png")
  })

  it("stays parent-controlled until fullscreenOpen is rerendered", async () => {
    const onFullscreenOpenChange = vi.fn()
    const props = {
      frames: [frame(0, 2), frame(1, 2)],
      frameIntervalMs: 1_000,
      outputName: "controlled",
      onFullscreenOpenChange,
    } as const
    const { rerender } = render(
      <AnimatedQrFrames {...props} fullscreenOpen={false} />,
    )
    const trigger = screen.getByRole("button", { name: "View full screen" })
    await waitFor(() => expect(trigger).toBeEnabled())

    fireEvent.click(trigger)
    expect(onFullscreenOpenChange).toHaveBeenLastCalledWith(true)
    expect(
      screen.queryByRole("dialog", {
        name: /View Multi-frame QR 1 \/ 2 full screen/,
      }),
    ).not.toBeInTheDocument()

    rerender(<AnimatedQrFrames {...props} fullscreenOpen />)
    const dialog = screen.getByRole("dialog", {
      name: /View Multi-frame QR 1 \/ 2 full screen/,
    })
    const close = within(dialog).getAllByRole("button", { name: "Close" })
    expect(close).toHaveLength(1)
    fireEvent.click(close[0]!)
    expect(onFullscreenOpenChange).toHaveBeenLastCalledWith(false)
    expect(dialog).toHaveAttribute("data-state", "open")

    rerender(<AnimatedQrFrames {...props} fullscreenOpen={false} />)
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", {
          name: /View Multi-frame QR 1 \/ 2 full screen/,
        }),
      ).not.toBeInTheDocument(),
    )
  })

  it("omits every export control and never calls export helpers when disabled", () => {
    render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={1_000}
        outputName="test"
        exportsEnabled={false}
      />,
    )

    expect(screen.queryByRole("button", { name: "Download" })).toBeNull()
    expect(sanitizeQrFileName).not.toHaveBeenCalled()
    expect(qrPngBlob).not.toHaveBeenCalled()
    expect(triggerDownload).not.toHaveBeenCalled()
  })
})

describe("useFrameSplit", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("keeps completed frames visible and lets only the newest success or error commit", async () => {
    const first = deferred<QrFrameV2[]>()
    const second = deferred<QrFrameV2[]>()
    const third = deferred<QrFrameV2[]>()
    splitIntoFrames
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)
      .mockImplementationOnce(() => third.promise)
    const bytes = Uint8Array.of(1, 2, 3)
    const { result, rerender } = renderHook(
      ({ frameBytes }) =>
        useFrameSplit({
          bytes,
          artifactType: "pq-message",
          frameBytes,
          enabled: true,
          generation: 1,
        }),
      { initialProps: { frameBytes: 200 } },
    )
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))
    const firstFrames = [frame(0, 1, { transfer: 1 })]
    await act(async () => {
      first.resolve(firstFrames)
      await first.promise
    })
    await waitFor(() => expect(result.current.frames).toBe(firstFrames))

    rerender({ frameBytes: 300 })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(2))
    expect(result.current.frames).toBe(firstFrames)
    expect(result.current.splitting).toBe(true)

    rerender({ frameBytes: 200 })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(3))
    const newestFrames = [frame(0, 1, { transfer: 3 })]
    await act(async () => {
      third.resolve(newestFrames)
      await third.promise
    })
    await waitFor(() => {
      expect(result.current.frames).toBe(newestFrames)
      expect(result.current.splitting).toBe(false)
    })
    second.reject(new AppError("QR_TOO_LARGE"))
    await act(async () => Promise.resolve())
    expect(result.current.frames).toBe(newestFrames)
    expect(result.current.error).toBeNull()
  })

  it("invalidates close, Back, selection change, close/reopen, and unmount sessions", async () => {
    const closing = deferred<QrFrameV2[]>()
    const reopened = deferred<QrFrameV2[]>()
    const backing = deferred<QrFrameV2[]>()
    const oldSelection = deferred<QrFrameV2[]>()
    const newSelection = deferred<QrFrameV2[]>()
    const unmounting = deferred<QrFrameV2[]>()
    splitIntoFrames
      .mockImplementationOnce(() => closing.promise)
      .mockImplementationOnce(() => reopened.promise)
      .mockImplementationOnce(() => backing.promise)
      .mockImplementationOnce(() => oldSelection.promise)
      .mockImplementationOnce(() => newSelection.promise)
      .mockImplementationOnce(() => unmounting.promise)

    const firstBytes = Uint8Array.of(1)
    const secondBytes = Uint8Array.of(2)
    const thirdBytes = Uint8Array.of(3)
    const { result, rerender, unmount } = renderHook(
      ({
        bytes,
        enabled,
        generation,
        frameBytes,
      }: {
        bytes: Uint8Array
        enabled: boolean
        generation: number
        frameBytes: number
      }) =>
        useFrameSplit({
          bytes,
          artifactType: "pq-message",
          frameBytes,
          enabled,
          generation,
        }),
      {
        initialProps: {
          bytes: firstBytes,
          enabled: true,
          generation: 1,
          frameBytes: 200,
        },
      },
    )
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))

    rerender({
      bytes: firstBytes,
      enabled: false,
      generation: 1,
      frameBytes: 200,
    })
    closing.resolve([frame(0, 1, { transfer: 1 })])
    await act(async () => Promise.resolve())
    expect(result.current.frames).toHaveLength(0)
    expect(result.current.error).toBeNull()

    rerender({
      bytes: firstBytes,
      enabled: true,
      generation: 2,
      frameBytes: 200,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(2))
    const reopenedFrames = [frame(0, 1, { transfer: 2 })]
    reopened.resolve(reopenedFrames)
    await waitFor(() => expect(result.current.frames).toBe(reopenedFrames))

    rerender({
      bytes: firstBytes,
      enabled: true,
      generation: 2,
      frameBytes: 300,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(3))
    rerender({
      bytes: firstBytes,
      enabled: false,
      generation: 3,
      frameBytes: 300,
    })
    backing.reject(new AppError("QR_TOO_LARGE"))
    await act(async () => Promise.resolve())
    expect(result.current.error).toBeNull()
    expect(result.current.frames).toHaveLength(0)

    rerender({
      bytes: secondBytes,
      enabled: true,
      generation: 4,
      frameBytes: 200,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(4))
    rerender({
      bytes: thirdBytes,
      enabled: true,
      generation: 5,
      frameBytes: 200,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(5))
    oldSelection.reject(new AppError("QR_TOO_LARGE"))
    const selectedFrames = [frame(0, 1, { transfer: 5 })]
    newSelection.resolve(selectedFrames)
    await waitFor(() => {
      expect(result.current.frames).toBe(selectedFrames)
      expect(result.current.error).toBeNull()
    })

    rerender({
      bytes: thirdBytes,
      enabled: true,
      generation: 5,
      frameBytes: 300,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(6))
    unmount()
    unmounting.resolve([frame(0, 1, { transfer: 6 })])
    await act(async () => Promise.resolve())
    expect(splitIntoFrames).toHaveBeenCalledTimes(6)
  })
})
