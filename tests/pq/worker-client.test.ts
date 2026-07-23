import { afterEach, describe, expect, it, vi } from "vitest"
import { createPqCryptoClient } from "@/crypto/pq/worker-client"

type Listener = (event: MessageEvent<unknown>) => void

class FakeWorker {
  static instances: FakeWorker[] = []
  readonly messages: unknown[] = []
  readonly transferArguments: unknown[] = []
  readonly listeners = new Map<string, Listener[]>()
  terminated = false

  constructor() {
    FakeWorker.instances.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  postMessage(message: unknown, transfer?: unknown): void {
    this.messages.push(message)
    this.transferArguments.push(transfer)
  }

  terminate(): void {
    this.terminated = true
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data } as MessageEvent<unknown>)
    }
  }
}

function browserGlobals(worker: typeof FakeWorker | undefined): void {
  vi.stubGlobal("window", {})
  vi.stubGlobal("Worker", worker)
}

function verifyRequest() {
  return {
    algorithm: "ML-DSA-87" as const,
    publicKey: new Uint8Array(2592),
    message: new Uint8Array([1, 2, 3]),
    signature: new Uint8Array(4627),
  }
}

afterEach(() => {
  FakeWorker.instances = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("browser PQ Worker RPC client", () => {
  it("fails closed when Worker is unavailable", () => {
    browserGlobals(undefined)
    expect(() => createPqCryptoClient()).toThrowError(
      expect.objectContaining({ code: "WORKER_UNAVAILABLE" }),
    )
  })

  it("validates lengths before postMessage", async () => {
    browserGlobals(FakeWorker)
    const client = createPqCryptoClient()
    const worker = FakeWorker.instances[0]!
    await expect(
      client.verify({ ...verifyRequest(), signature: new Uint8Array(1) }),
    ).rejects.toMatchObject({ code: "SIGNATURE_INVALID" })
    expect(worker.messages).toHaveLength(0)
    client.dispose()
  })

  it("correlates responses and never transfers caller input buffers", async () => {
    browserGlobals(FakeWorker)
    const client = createPqCryptoClient()
    const worker = FakeWorker.instances[0]!
    const firstRequest = verifyRequest()
    const secondRequest = verifyRequest()
    const first = client.verify(firstRequest)
    const second = client.verify(secondRequest)
    expect(worker.messages).toHaveLength(2)
    const firstRpc = worker.messages[0] as { id: string }
    const secondRpc = worker.messages[1] as { id: string }
    expect(firstRpc.id).not.toBe(secondRpc.id)
    expect(worker.transferArguments).toEqual([undefined, undefined])
    expect(firstRequest.signature.byteLength).toBe(4627)

    worker.emit("message", { id: secondRpc.id, ok: true, value: false })
    worker.emit("message", { id: firstRpc.id, ok: true, value: true })
    await expect(first).resolves.toBe(true)
    await expect(second).resolves.toBe(false)
    client.dispose()
  })

  it("terminates on timeout and ignores a late response", async () => {
    vi.useFakeTimers()
    browserGlobals(FakeWorker)
    const client = createPqCryptoClient({ timeoutMs: 10 })
    const worker = FakeWorker.instances[0]!
    const pending = client.verify(verifyRequest())
    const rejection = expect(pending).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    })
    const rpc = worker.messages[0] as { id: string }
    await vi.advanceTimersByTimeAsync(11)
    await rejection
    expect(worker.terminated).toBe(true)
    expect(() =>
      worker.emit("message", { id: rpc.id, ok: true, value: true }),
    ).not.toThrow()
  })

  it("sanitizes malformed responses and terminates the worker", async () => {
    browserGlobals(FakeWorker)
    const client = createPqCryptoClient()
    const worker = FakeWorker.instances[0]!
    const pending = client.verify(verifyRequest())
    const rpc = worker.messages[0] as { id: string }
    worker.emit("message", {
      id: rpc.id,
      ok: false,
      code: "raw stack and secret material",
    })
    await expect(pending).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" })
    expect(worker.terminated).toBe(true)
  })
})
