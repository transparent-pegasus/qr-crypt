import "./helpers/module-mocks"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import { AppError, messageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import type { TransferState } from "@/qr/multipart/transfer-state"
import { deferred } from "../helpers/deferred"
import {
  emitScannedPayload,
  multipartPayload,
  scannerStop,
  startQrScan,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function scanner(
  session: MultipartScanSession,
  onComplete = vi.fn(),
) {
  return <QrScannerPanel multipart={{ session, onComplete }} />
}

describe("QrScannerPanel multipart scan", () => {
  beforeEach(resetUi)
  afterEach(() => {
    vi.useRealTimers()
    resetUi()
  })

  it("uses discard as the only stop action and preserves progress across remount", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    const view = render(scanner(session, onComplete))
    expect(startQrScan).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(startQrScan.mock.calls[0]?.[3]).toMatchObject({ once: false })
    expect(
      screen.queryByRole("button", { name: "Stop camera" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Discard scan state" }),
    ).toHaveClass("w-full")
    expect(
      screen.getByText(
        "Camera images are not stored. Scanning stops when you close the dialog, discard the scan state, or leave the screen.",
      ),
    ).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 2, 3)),
    )
    expect(await screen.findByText("Received 1 / 3")).toBeInTheDocument()
    expect(
      screen.getByText("Missing frames: frame 1, frame 2"),
    ).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 2, 3)),
    )
    expect(screen.getByText("Received 1 / 3")).toBeInTheDocument()
    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 3)),
    )
    expect(await screen.findByText("Received 2 / 3")).toBeInTheDocument()
    expect(screen.getByText("Missing frames: frame 2")).toBeInTheDocument()

    view.unmount()
    expect(scannerStop).toHaveBeenCalledOnce()
    render(scanner(session, onComplete))
    expect(screen.getByText("Received 2 / 3")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(screen.getByText("Received 2 / 3")).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 1, 3)),
    )
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-public-identity",
      artifactBytes: Uint8Array.of(3),
    })
    expect(
      screen.getByText("SHA-256 integrity was confirmed for all frames."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 1, 3)),
    )
    expect(onComplete).toHaveBeenCalledOnce()
  })

  it("delivers an unclaimed complete session without starting the camera", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    vi.spyOn(session, "state").mockReturnValue({
      kind: "complete",
      transferId: Uint8Array.of(1),
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    })
    const onComplete = vi.fn()
    render(scanner(session, onComplete))

    await user.click(screen.getByRole("button", { name: "Start camera" }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    })
    expect(startQrScan).not.toHaveBeenCalled()
    expect(scannerStop).not.toHaveBeenCalled()
  })

  it("rejects a competing bare payload while collecting frames", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    render(scanner(session))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    act(() => emitScannedPayload("OCM1:single"))

    expect(
      await screen.findByText(
        "This QR code is not accepted (Not from this app). This screen can scan multi-frame QR.",
      ),
    ).toBeInTheDocument()
    expect(await screen.findByText("Received 1 / 2")).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()
  })

  it("keeps the camera running on transfer error, then discards to idle", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    render(scanner(session))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await screen.findByText("QR codes can be read in any order")

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 2)),
    )
    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-b", 1, 2)),
    )
    expect(
      await screen.findByText(messageFor("FRAME_MISMATCH", "en")),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Stop camera" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Discard scan state" }),
    ).toBeEnabled()
    expect(scannerStop).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "Discard scan state" }))
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(
      screen.queryByLabelText("Multi-frame QR scan progress"),
    ).not.toBeInTheDocument()
    expect(startQrScan).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
  })

  it("suppresses completion from a pending add after discard", async () => {
    const pending = deferred<TransferState>()
    const session = new MultipartScanSession(5)
    vi.spyOn(session, "add").mockReturnValueOnce(pending.promise)
    const onComplete = vi.fn()
    render(scanner(session, onComplete))
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload("OCF2:pending"))
    fireEvent.click(screen.getByRole("button", { name: "Discard scan state" }))
    await act(async () =>
      pending.resolve({
        kind: "complete",
        transferId: Uint8Array.of(1),
        artifactType: "pq-message",
        artifactBytes: Uint8Array.of(2),
      }),
    )

    expect(onComplete).not.toHaveBeenCalled()
    expect(
      screen.queryByText("SHA-256 integrity was confirmed for all frames."),
    ).not.toBeInTheDocument()
  })

  it("shows an AppError from the one-time completion callback", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn(() => {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    })
    render(scanner(session, onComplete))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 1)),
    )

    expect(onComplete).toHaveBeenCalledOnce()
    expect(
      await screen.findByText(messageFor("UNSUPPORTED_ALGORITHM", "en")),
    ).toBeInTheDocument()
    expect(
      screen.getByText("SHA-256 integrity was confirmed for all frames."),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()
  })

  it("locks restart and discard while completion delivery is pending", async () => {
    const delivery = deferred<void>()
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn(() => delivery.promise)
    render(scanner(session, onComplete))
    await user.click(screen.getByRole("button", { name: "Start camera" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 1)))
    expect(await screen.findByText("Importing…")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "Start camera" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Discard scan state" }),
    ).toBeDisabled()

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 1)))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(startQrScan).toHaveBeenCalledOnce()

    await act(async () => delivery.resolve())
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "Discard scan state" }),
    ).toBeEnabled()
  })

  it("detects timeout, stops, and returns to idle", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"))
    const session = new MultipartScanSession(1)
    render(scanner(session))
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText("Received 1 / 2")).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(61_000))

    expect(
      screen.getByText("The temporary scan state expired and was discarded."),
    ).toBeInTheDocument()
    expect(
      screen.queryByLabelText("Multi-frame QR scan progress"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()
    expect(scannerStop).toHaveBeenCalled()
  })

  it("reflects an external discard and stops the current run", async () => {
    vi.useFakeTimers()
    const session = new MultipartScanSession(5)
    render(scanner(session))
    fireEvent.click(screen.getByRole("button", { name: "Start camera" }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText("Received 1 / 2")).toBeInTheDocument()

    session.discard()
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(
      screen.queryByLabelText("Multi-frame QR scan progress"),
    ).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "Start camera" })).toBeEnabled()
    expect(scannerStop).toHaveBeenCalled()
  })
})
