import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createPqCryptoClient,
  type OpenPqEnvelopeRequest,
  type PqCryptoClient,
  type VerifySignedMessageRequest,
} from "@/crypto/pq/worker-client"

type Listener = (event: MessageEvent<unknown>) => void

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const MESSAGE_ID = new Uint8Array(16).fill(0x41)
const CREATED_AT = 1_700_000_000_123

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

function openRequest(): OpenPqEnvelopeRequest {
  return {
    envelope: {
      version: 2,
      type: "pq-message",
      suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
      recipientKemKeyId: KEY_ID,
      kemCiphertext: new Uint8Array(1568),
      hkdfSalt: new Uint8Array(32),
      iv: new Uint8Array(12),
      ciphertext: new Uint8Array(16),
    },
    recipient: {
      identityId: KEY_ID,
      kemAlgorithm: "ML-KEM-1024",
      kemKeyId: KEY_ID,
      encryptedKemSeed: {
        iv: new Uint8Array(12),
        ciphertext: new Uint8Array(80),
      },
      storedKemPublicKey: new Uint8Array(1568),
      vaultKey: {
        type: "secret",
        extractable: false,
        algorithm: { name: "AES-GCM", length: 256 },
        usages: ["encrypt", "decrypt"],
      } as CryptoKey,
    },
  }
}

function verifySignedMessageRequest(): VerifySignedMessageRequest {
  return {
    signedMessageBytes: new Uint8Array([1]),
    senderPublicKey: new Uint8Array(2592),
    algorithm: "ML-DSA-87",
  }
}

async function expectResponseRejected(
  invoke: (client: PqCryptoClient) => Promise<unknown>,
  value: unknown,
): Promise<void> {
  browserGlobals(FakeWorker)
  const client = createPqCryptoClient()
  const worker = FakeWorker.instances[0]!
  const pending = invoke(client)
  const rpc = worker.messages[0] as { id: string }
  worker.emit("message", { id: rpc.id, ok: true, value })
  await expect(pending).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" })
  expect(worker.terminated).toBe(true)
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

  it("rejects a retired unsigned open response missing messageId", async () => {
    await expectResponseRejected(
      (client) => client.openPqEnvelope(openRequest()),
      {
        kind: "unsigned",
        plaintext: new Uint8Array([1]),
        createdAt: CREATED_AT,
      },
    )
  })

  it("rejects a valid verification response with a non-16-byte messageId", async () => {
    await expectResponseRejected(
      (client) => client.verifySignedMessage(verifySignedMessageRequest()),
      {
        valid: true,
        plaintext: new Uint8Array([1]),
        messageId: new Uint8Array(15),
        createdAt: CREATED_AT,
      },
    )
  })

  it("rejects a retired unsigned open response with a non-integer createdAt", async () => {
    await expectResponseRejected(
      (client) => client.openPqEnvelope(openRequest()),
      {
        kind: "unsigned",
        plaintext: new Uint8Array([1]),
        messageId: MESSAGE_ID,
        createdAt: CREATED_AT + 0.5,
      },
    )
  })

  it("rejects an invalid verification response carrying receipt fields", async () => {
    await expectResponseRejected(
      (client) => client.verifySignedMessage(verifySignedMessageRequest()),
      {
        valid: false,
        messageId: MESSAGE_ID,
        createdAt: CREATED_AT,
      },
    )
  })

  it("rejects a signed open response carrying receipt fields", async () => {
    await expectResponseRejected(
      (client) => client.openPqEnvelope(openRequest()),
      {
        kind: "signed",
        signedMessageBytes: new Uint8Array([1]),
        senderSigningKeyId: KEY_ID,
        signatureAlgorithm: "ML-DSA-87",
        messageId: MESSAGE_ID,
        createdAt: CREATED_AT,
      },
    )
  })
})
