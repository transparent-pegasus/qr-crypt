import "./helpers/module-mocks"
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { QrScannerPanel } from "@/components/qr-scanner-panel"
import { AppError, userMessageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import type { TransferState } from "@/qr/multipart/transfer-state"
import {
  emitScannedPayload,
  multipartPayload,
  scannerStop,
  startQrScan,
} from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve }
}

function scanner(
  session: MultipartScanSession,
  onComplete = vi.fn(),
  onSingleScan = vi.fn(),
) {
  return (
    <QrScannerPanel
      singleTargets={["message"]}
      onSingleScan={onSingleScan}
      multipart={{ session, onComplete }}
    />
  )
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

    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    expect(startQrScan.mock.calls[0]?.[3]).toMatchObject({ once: false })
    expect(
      screen.queryByRole("button", { name: "カメラを停止" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "読取状態を破棄" }),
    ).toHaveClass("w-full")
    expect(
      screen.getByText(
        "カメラ画像は保存されません。閉じる・破棄ボタン・画面離脱で停止します。",
      ),
    ).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 2, 3)),
    )
    expect(await screen.findByText("受信 1 / 3")).toBeInTheDocument()
    expect(screen.getByText("欠損 index: 0, 1")).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 2, 3)),
    )
    expect(screen.getByText("受信 1 / 3")).toBeInTheDocument()
    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 3)),
    )
    expect(await screen.findByText("受信 2 / 3")).toBeInTheDocument()
    expect(screen.getByText("欠損 index: 1")).toBeInTheDocument()

    view.unmount()
    expect(scannerStop).toHaveBeenCalledOnce()
    render(scanner(session, onComplete))
    expect(screen.getByText("受信 2 / 3")).toBeInTheDocument()
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(screen.getByText("受信 2 / 3")).toBeInTheDocument()

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 1, 3)),
    )
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-public-identity",
      artifactBytes: Uint8Array.of(3),
    })
    expect(
      screen.getByText("全フレームのSHA-256整合性を確認しました。"),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()

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

    await user.click(screen.getByRole("button", { name: "カメラを起動" }))

    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-message",
      artifactBytes: Uint8Array.of(2),
    })
    expect(startQrScan).not.toHaveBeenCalled()
    expect(scannerStop).not.toHaveBeenCalled()
  })

  it("locks to multipart synchronously and rejects a competing single payload", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onSingleScan = vi.fn()
    render(scanner(session, vi.fn(), onSingleScan))
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    act(() => emitScannedPayload("OCM1:single"))

    expect(
      await screen.findByText(
        "複数QR読取中です。単発QRは読取完了または破棄後に。",
      ),
    ).toBeInTheDocument()
    expect(onSingleScan).not.toHaveBeenCalled()
    expect(await screen.findByText("受信 1 / 2")).toBeInTheDocument()
    expect(scannerStop).not.toHaveBeenCalled()
  })

  it("keeps the camera running on transfer error, then discards to idle", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    render(scanner(session))
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await screen.findByText("QRコードを順不同で読み取れます")

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 2)),
    )
    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-b", 1, 2)),
    )
    expect(
      await screen.findByText(userMessageFor("FRAME_MISMATCH")),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "カメラを停止" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "読取状態を破棄" }),
    ).toBeEnabled()
    expect(scannerStop).not.toHaveBeenCalled()

    await user.click(screen.getByRole("button", { name: "読取状態を破棄" }))
    expect(scannerStop).toHaveBeenCalledOnce()
    expect(screen.queryByLabelText("複数QR読取進捗")).not.toBeInTheDocument()
    expect(startQrScan).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()

    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
  })

  it("suppresses completion from a pending add after discard", async () => {
    const pending = deferred<TransferState>()
    const session = new MultipartScanSession(5)
    vi.spyOn(session, "add").mockReturnValueOnce(pending.promise)
    const onComplete = vi.fn()
    render(scanner(session, onComplete))
    fireEvent.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload("OCF2:pending"))
    fireEvent.click(screen.getByRole("button", { name: "読取状態を破棄" }))
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
      screen.queryByText("全フレームのSHA-256整合性を確認しました。"),
    ).not.toBeInTheDocument()
  })

  it("shows an AppError from the one-time completion callback", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn(() => {
      throw new AppError("UNSUPPORTED_ALGORITHM")
    })
    render(scanner(session, onComplete))
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () =>
      emitScannedPayload(multipartPayload("transfer-a", 0, 1)),
    )

    expect(onComplete).toHaveBeenCalledOnce()
    expect(
      await screen.findByText(userMessageFor("UNSUPPORTED_ALGORITHM")),
    ).toBeInTheDocument()
    expect(
      screen.getByText("全フレームのSHA-256整合性を確認しました。"),
    ).toBeInTheDocument()
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()
  })

  it("locks restart and discard while completion delivery is pending", async () => {
    const delivery = deferred<void>()
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn(() => delivery.promise)
    render(scanner(session, onComplete))
    await user.click(screen.getByRole("button", { name: "カメラを起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 1)))
    expect(await screen.findByText("取り込み中です…")).toBeInTheDocument()
    expect(
      screen.queryByRole("button", { name: "カメラを起動" }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "読取状態を破棄" }),
    ).toBeDisabled()

    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 1)))
    expect(onComplete).toHaveBeenCalledOnce()
    expect(startQrScan).toHaveBeenCalledOnce()

    await act(async () => delivery.resolve())
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()
    expect(
      screen.getByRole("button", { name: "読取状態を破棄" }),
    ).toBeEnabled()
  })

  it("detects timeout, stops, and returns to idle", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"))
    const session = new MultipartScanSession(1)
    render(scanner(session))
    fireEvent.click(screen.getByRole("button", { name: "カメラを起動" }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText("受信 1 / 2")).toBeInTheDocument()

    await act(async () => vi.advanceTimersByTimeAsync(61_000))

    expect(
      screen.getByText("読取期限を過ぎたため、一時読取状態を破棄しました。"),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("複数QR読取進捗")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()
    expect(scannerStop).toHaveBeenCalled()
  })

  it("reflects an external discard and stops the current run", async () => {
    vi.useFakeTimers()
    const session = new MultipartScanSession(5)
    render(scanner(session))
    fireEvent.click(screen.getByRole("button", { name: "カメラを起動" }))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    act(() => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText("受信 1 / 2")).toBeInTheDocument()

    session.discard()
    await act(async () => vi.advanceTimersByTimeAsync(1_000))

    expect(screen.queryByLabelText("複数QR読取進捗")).not.toBeInTheDocument()
    expect(screen.getByRole("button", { name: "カメラを起動" })).toBeEnabled()
    expect(scannerStop).toHaveBeenCalled()
  })
})
