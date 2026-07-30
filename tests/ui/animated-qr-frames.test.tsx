import "./helpers/module-mocks"
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AnimatedQrFrames } from "@/components/animated-qr-frames"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import type { QrFrameV2 } from "@/schemas/domain"
import { env } from "@/schemas/env-schema"
import { deferred } from "../helpers/deferred"
import {
  exportQrFramePayloads,
  qrPngBlob,
  renderQrDataUrl,
  sanitizeQrFileName,
  triggerDownload,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

const defaultQrMaxFrames = env.qrMaxFrames

function frame(
  frameIndex: number,
  frameCount: number,
  {
    transfer = 0,
  }: { transfer?: number } = {},
): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16).fill(transfer),
    artifactType: "pq-message",
    frameIndex,
    frameCount,
    totalByteLength: frameCount,
    chunk: Uint8Array.of(frameIndex),
  }
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

  it("shows the density-clamp notice only when compatible density is raised", () => {
    const { rerender } = render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={2_000}
        outputName="test"
      />,
    )

    expect(
      screen.queryByText(
        "Frame density could not be lowered further because this transfer must stay within the frame limit.",
      ),
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
      screen.getByText(
        "Frame density could not be lowered further because this transfer must stay within the frame limit.",
      ),
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

  it("keeps fullscreen mounted through a split gap and resets the new transfer to frame one", async () => {
    const initialFrames = [frame(0, 2), frame(1, 2)]
    const { rerender } = render(
      <AnimatedQrFrames
        frames={initialFrames}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("2 / 2")).toBeInTheDocument()
    const trigger = screen.getByRole("button", { name: "View full screen" })
    await waitFor(() => expect(trigger).toBeEnabled())
    fireEvent.click(trigger)
    const dialog = screen.getByRole("dialog", {
      name: /View Multi-frame QR 2 \/ 2 full screen/,
    })

    rerender(
      <AnimatedQrFrames
        frames={[]}
        frameIntervalMs={1_000}
        outputName="test"
        splitting
      />,
    )
    expect(
      screen.getByRole("dialog", {
        name: /View Multi-frame QR 2 \/ 2 full screen/,
      }),
    ).toBe(dialog)
    expect(within(dialog).getByRole("img")).toBeInTheDocument()

    rerender(
      <AnimatedQrFrames
        frames={[
          frame(0, 3, { transfer: 1 }),
          frame(1, 3, { transfer: 1 }),
          frame(2, 3, { transfer: 1 }),
        ]}
        frameIntervalMs={1_000}
        outputName="test"
      />,
    )
    await waitFor(() => expect(within(dialog).getByText("1 / 3")).toBeInTheDocument())
    expect(
      screen.getByRole("dialog", {
        name: /View Multi-frame QR 1 \/ 3 full screen/,
      }),
    ).toBe(dialog)
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

  it("passes protocol frame indexes and the output name to the shared export", async () => {
    render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={1_000}
        outputName="shared-export"
      />,
    )

    fireEvent.click(screen.getByRole("button", { name: "Download" }))

    await waitFor(() =>
      expect(exportQrFramePayloads).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            frameIndex: expect.any(Number),
            payload: expect.any(String),
          }),
        ]),
        expect.objectContaining({
          outputName: "shared-export",
          size: expect.any(Number),
        }),
      ),
    )
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
