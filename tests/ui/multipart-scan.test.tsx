import "./helpers/module-mocks"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { MultipartScanPanel } from "@/components/multipart-scan-panel"
import { userMessageFor } from "@/crypto/errors"
import { MultipartScanSession } from "@/features/multipart-scan-session"
import { emitScannedPayload, multipartPayload, startQrScan } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

describe("multipart continuous scan UI", () => {
  beforeEach(resetUi)
  afterEach(() => {
    vi.useRealTimers()
    resetUi()
  })

  it("accepts out-of-order frames, ignores duplicates, shows missing indexes, and survives camera restart", async () => {
    const user = userEvent.setup()
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    render(<MultipartScanPanel session={session} onComplete={onComplete} />)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 2, 3)))
    expect(await screen.findByText("受信 1 / 3")).toBeInTheDocument()
    expect(screen.getByText("欠損 index: 0, 1")).toBeInTheDocument()

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 2, 3)))
    expect(screen.getByText("受信 1 / 3")).toBeInTheDocument()

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 0, 3)))
    expect(await screen.findByText("受信 2 / 3")).toBeInTheDocument()
    expect(screen.getByText("欠損 index: 1")).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "カメラを再起動" }))
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(screen.getByText("受信 2 / 3")).toBeInTheDocument()

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 1, 3)))
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
    expect(onComplete).toHaveBeenCalledWith({
      artifactType: "pq-public-identity",
      artifactBytes: Uint8Array.of(3),
    })
    expect(
      screen.getByText("全フレームのSHA-256整合性を確認しました。"),
    ).toBeInTheDocument()
  })

  it("rejects frames from another transfer with the FRAME_MISMATCH user message", async () => {
    const session = new MultipartScanSession(5)
    render(<MultipartScanPanel session={session} onComplete={vi.fn()} />)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    expect(await screen.findByText("欠損 index: 1")).toBeInTheDocument()
    await act(async () => emitScannedPayload(multipartPayload("transfer-b", 1, 2)))

    expect(await screen.findByText(userMessageFor("FRAME_MISMATCH"))).toBeInTheDocument()
  })

  it("keeps assembler progress when the scanner panel is remounted", async () => {
    const session = new MultipartScanSession(5)
    const onComplete = vi.fn()
    const first = render(<MultipartScanPanel session={session} onComplete={onComplete} />)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledOnce())
    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 0, 2)))
    expect(await screen.findByText("受信 1 / 2")).toBeInTheDocument()

    first.unmount()
    render(<MultipartScanPanel session={session} onComplete={onComplete} />)
    await waitFor(() => expect(startQrScan).toHaveBeenCalledTimes(2))
    expect(screen.getByText("受信 1 / 2")).toBeInTheDocument()

    await act(async () => emitScannedPayload(multipartPayload("transfer-a", 1, 2)))
    await waitFor(() => expect(onComplete).toHaveBeenCalledOnce())
  })

  it("discards an incomplete transfer and reports timeout", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-01-02T03:04:05Z"))
    const session = new MultipartScanSession(1)
    render(<MultipartScanPanel session={session} onComplete={vi.fn()} />)
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(startQrScan).toHaveBeenCalledOnce()

    await act(async () => {
      emitScannedPayload(multipartPayload("transfer-a", 0, 2))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(screen.getByText("受信 1 / 2")).toBeInTheDocument()

    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000)
    })
    expect(
      screen.getByText("読取期限を過ぎたため、一時読取状態を破棄しました。"),
    ).toBeInTheDocument()
    expect(screen.queryByLabelText("複数QR読取進捗")).not.toBeInTheDocument()
  })
})
