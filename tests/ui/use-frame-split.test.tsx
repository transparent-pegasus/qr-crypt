import "./helpers/module-mocks"
import { act, renderHook, waitFor } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { AppError } from "@/crypto/errors"
import { useFrameSplit } from "@/hooks/use-frame-split"
import type { QrFrameV2 } from "@/schemas/domain"
import { deferred } from "../helpers/deferred"
import { splitIntoFrames } from "./helpers/fakes"
import { resetUi } from "./helpers/render-app"

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

  it("invalidates stale sessions across close, reopen, selection change, and unmount", async () => {
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
