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
  qrPngBlob,
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

  it("shows one-based English missing-frame positions and the current speed grid", () => {
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
    const speed = screen.getByLabelText("Display speed")
    expect(speed).toHaveAttribute("min", "1000")
    expect(speed).toHaveAttribute("max", "3000")
    expect(speed).toHaveAttribute("step", "500")
    fireEvent.change(speed, { target: { value: "2500" } })
    expect(speed).toHaveValue("2500")
  })

  it("moves one control set into fullscreen and keeps the same unpaused timer alive", async () => {
    vi.useFakeTimers()
    const onFrameBytesChange = vi.fn()
    const onFrameIntervalMsChange = vi.fn()
    render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={1_000}
        frameBytes={100}
        onFrameBytesChange={onFrameBytesChange}
        onFrameIntervalMsChange={onFrameIntervalMsChange}
        outputName="test"
      />,
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })

    fireEvent.click(screen.getByRole("button", { name: "View full screen" }))
    const dialog = screen.getByRole("dialog", {
      name: /View Multi-frame QR 1 \/ 2 full screen/,
    })
    expect(within(dialog).getByText("1 / 2")).toBeInTheDocument()
    expect(screen.getAllByLabelText("Display speed")).toHaveLength(1)
    expect(screen.getAllByRole("radiogroup", { name: "Frame density" })).toHaveLength(1)
    expect(within(dialog).getByLabelText("Display speed").id).toMatch(/-fullscreen$/)
    const density = within(dialog).getByRole("radiogroup", {
      name: "Frame density",
    })
    expect(density.id).toMatch(/-fullscreen$/)
    const density100 = within(density).getByRole("radio", { name: "100 B" })
    const density200 = within(density).getByRole("radio", { name: "200 B" })
    expect(density100).toBeEnabled()
    expect(density100).toBeChecked()
    expect(density200).toBeEnabled()
    expect(density200).not.toBeChecked()
    const ids = Array.from(dialog.querySelectorAll("input[id]")).map((input) => input.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(document.querySelectorAll(`input[id="${id}"]`)).toHaveLength(1)
    }

    act(() => vi.advanceTimersByTime(1_000))
    expect(within(dialog).getByText("2 / 2")).toBeInTheDocument()
    expect(dialog).toBeInTheDocument()

    fireEvent.change(within(dialog).getByLabelText("Display speed"), {
      target: { value: "1500" },
    })
    expect(onFrameIntervalMsChange).toHaveBeenCalledWith(1_500)
    fireEvent.click(density200)
    expect(onFrameBytesChange).toHaveBeenCalledWith(200)

    const fullscreenClose = within(dialog).getAllByRole("button", { name: "Close" })
    expect(fullscreenClose).toHaveLength(1)
    fireEvent.click(fullscreenClose[0]!)
    const closingInputs = screen.getAllByRole("slider")
    expect(new Set(closingInputs.map((input) => input.id)).size).toBe(
      closingInputs.length,
    )
    expect(
      screen
        .getAllByLabelText("Display speed")
        .find((input) => input.id.endsWith("-inline")),
    ).toHaveValue("1500")
    expect(
      screen
        .getAllByRole("radiogroup", { name: "Frame density" })
        .some((input) => input.id.endsWith("-inline")),
    ).toBe(true)
  })

  it("disables 100 B when the artifact exceeds a configured 64-frame floor", async () => {
    env.qrMaxFrames = 64
    const onFrameBytesChange = vi.fn()
    render(
      <AnimatedQrFrames
        frames={[
          frame(0, 34, { totalByteLength: 6_613 }),
          frame(1, 34, { totalByteLength: 6_613 }),
        ]}
        frameIntervalMs={2_000}
        frameBytes={200}
        onFrameBytesChange={onFrameBytesChange}
        outputName="signed"
      />,
    )
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "View full screen" })).toBeEnabled(),
    )
    fireEvent.click(screen.getByRole("button", { name: "View full screen" }))
    const density = screen.getByRole("radiogroup", { name: "Frame density" })
    const density100 = within(density).getByRole("radio", { name: "100 B" })
    const density200 = within(density).getByRole("radio", { name: "200 B" })
    expect(density100).toBeDisabled()
    expect(density100).not.toBeChecked()
    expect(density200).toBeEnabled()
    expect(density200).toBeChecked()
    fireEvent.click(density100)
    expect(onFrameBytesChange).not.toHaveBeenCalled()
  })

  it("resets to frame one when a same-length transfer generation replaces the frames", async () => {
    const { rerender } = render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={2_000}
        outputName="test"
      />,
    )
    fireEvent.click(screen.getByRole("button", { name: "Next" }))
    expect(screen.getByText("2 / 2")).toBeInTheDocument()

    rerender(
      <AnimatedQrFrames
        frames={[frame(0, 2, { transfer: 1 }), frame(1, 2, { transfer: 1 })]}
        frameIntervalMs={2_000}
        outputName="test"
      />,
    )
    await waitFor(() => expect(screen.getByText("1 / 2")).toBeInTheDocument())
  })

  it("uses accessible export descriptions while showing three bare format nouns in one row", () => {
    render(
      <AnimatedQrFrames
        frames={[frame(0, 2), frame(1, 2)]}
        frameIntervalMs={2_000}
        outputName="test"
      />,
    )

    const png = screen.getByRole("button", { name: "Export all PNGs" })
    const zip = screen.getByRole("button", { name: "Export ZIP" })
    const svg = screen.getByRole("button", { name: "Current SVG" })
    expect(png).toHaveTextContent(/^PNG$/)
    expect(zip).toHaveTextContent(/^ZIP$/)
    expect(svg).toHaveTextContent(/^SVG$/)
    expect(png.parentElement).toBe(zip.parentElement)
    expect(png.parentElement).toBe(svg.parentElement)
    expect(png.parentElement).toHaveClass("grid", "grid-cols-3")
  })

  it("stays parent-controlled until fullscreenOpen is rerendered", async () => {
    const onFullscreenOpenChange = vi.fn()
    const props = {
      frames: [frame(0, 2), frame(1, 2)],
      frameIntervalMs: 2_000,
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
        frameIntervalMs={2_000}
        outputName="test"
        exportsEnabled={false}
      />,
    )

    expect(screen.queryByRole("button", { name: "Export all PNGs" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Export ZIP" })).toBeNull()
    expect(screen.queryByRole("button", { name: "Current SVG" })).toBeNull()
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
      { initialProps: { frameBytes: 100 } },
    )
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))
    const firstFrames = [frame(0, 1, { transfer: 1 })]
    await act(async () => {
      first.resolve(firstFrames)
      await first.promise
    })
    await waitFor(() => expect(result.current.frames).toBe(firstFrames))

    rerender({ frameBytes: 200 })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(2))
    expect(result.current.frames).toBe(firstFrames)
    expect(result.current.splitting).toBe(true)

    rerender({ frameBytes: 100 })
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
          frameBytes: 100,
        },
      },
    )
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(1))

    rerender({
      bytes: firstBytes,
      enabled: false,
      generation: 1,
      frameBytes: 100,
    })
    closing.resolve([frame(0, 1, { transfer: 1 })])
    await act(async () => Promise.resolve())
    expect(result.current.frames).toHaveLength(0)
    expect(result.current.error).toBeNull()

    rerender({
      bytes: firstBytes,
      enabled: true,
      generation: 2,
      frameBytes: 100,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(2))
    const reopenedFrames = [frame(0, 1, { transfer: 2 })]
    reopened.resolve(reopenedFrames)
    await waitFor(() => expect(result.current.frames).toBe(reopenedFrames))

    rerender({
      bytes: firstBytes,
      enabled: true,
      generation: 2,
      frameBytes: 200,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(3))
    rerender({
      bytes: firstBytes,
      enabled: false,
      generation: 3,
      frameBytes: 200,
    })
    backing.reject(new AppError("QR_TOO_LARGE"))
    await act(async () => Promise.resolve())
    expect(result.current.error).toBeNull()
    expect(result.current.frames).toHaveLength(0)

    rerender({
      bytes: secondBytes,
      enabled: true,
      generation: 4,
      frameBytes: 100,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(4))
    rerender({
      bytes: thirdBytes,
      enabled: true,
      generation: 5,
      frameBytes: 100,
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
      frameBytes: 200,
    })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledTimes(6))
    unmount()
    unmounting.resolve([frame(0, 1, { transfer: 6 })])
    await act(async () => Promise.resolve())
    expect(splitIntoFrames).toHaveBeenCalledTimes(6)
  })
})
