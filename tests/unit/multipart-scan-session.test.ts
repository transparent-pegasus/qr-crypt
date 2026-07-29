import { describe, expect, it, vi } from "vitest"

import { MultipartScanSession } from "@/features/multipart-scan-session"
import { TransferAssembler } from "@/qr/multipart/assemble"
import type { TransferState } from "@/qr/multipart/transfer-state"

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve()
}

describe("MultipartScanSession", () => {
  it("serializes concurrent add calls on one session", async () => {
    const first = deferred<TransferState>()
    const second = deferred<TransferState>()
    const pending = [first, second]
    let active = 0
    let maximumActive = 0
    const add = vi
      .spyOn(TransferAssembler.prototype, "add")
      .mockImplementation(async () => {
        active += 1
        maximumActive = Math.max(maximumActive, active)
        const operation = pending.shift()
        try {
          return await operation!.promise
        } finally {
          active -= 1
        }
      })
    const session = new MultipartScanSession(5)

    const firstResult = session.add("OCF2:first")
    const secondResult = session.add("OCF2:second")
    await flushMicrotasks()

    expect(add).toHaveBeenCalledOnce()
    expect(maximumActive).toBe(1)

    first.resolve({ kind: "idle" })
    await expect(firstResult).resolves.toEqual({ kind: "idle" })
    await flushMicrotasks()
    expect(add).toHaveBeenCalledTimes(2)
    expect(maximumActive).toBe(1)

    second.resolve({ kind: "idle" })
    await expect(secondResult).resolves.toEqual({ kind: "idle" })
    expect(maximumActive).toBe(1)
    add.mockRestore()
  })

  it("invalidates queued frames when the session is discarded", async () => {
    const pending = deferred<TransferState>()
    const add = vi
      .spyOn(TransferAssembler.prototype, "add")
      .mockImplementationOnce(() => pending.promise)
    const session = new MultipartScanSession(5)

    const activeResult = session.add("OCF2:active")
    const queuedResult = session.add("OCF2:queued")
    await flushMicrotasks()
    expect(add).toHaveBeenCalledOnce()

    session.discard()
    pending.resolve({ kind: "idle" })

    await expect(activeResult).resolves.toEqual({ kind: "idle" })
    await expect(queuedResult).resolves.toEqual({ kind: "idle" })
    expect(add).toHaveBeenCalledOnce()
    add.mockRestore()
  })
})
