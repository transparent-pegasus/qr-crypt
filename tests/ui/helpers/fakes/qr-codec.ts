import { vi } from "vitest"
import { AppError, type ErrorCode } from "@/crypto/errors"
import { fromBase64Url } from "@/lib/base64url"
import {
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  SYM_MESSAGE_OVERHEAD_BYTES,
} from "@/lib/limits"
import type { TransferState } from "@/qr/multipart/transfer-state"
import type {
  MlKemMessageEnvelopeV2,
  PublicIdentityBundleV2,
  QrFrameV2,
  SymMessageEnvelopeV2,
  SymmetricKeyEnvelopeV2,
  V2ArtifactType,
} from "@/schemas/domain"
import { buildPublicBundle } from "./pq-crypto"
import { fakeIdentities } from "./pq-records"
import { registerFakeReset } from "./reset"
import {
  getLastPqEnvelope,
  getLastPublicBundle,
  getLastSymMessageEnvelope,
  resetWireState,
  setLastPublicBundle,
  setLastSymMessageEnvelope,
} from "./wire-state"

const encoder = new TextEncoder()

export const decodePayload = vi.fn((payload: string) => {
  if (payload.startsWith("OCK2:")) {
    return {
      kind: "symmetric-key" as const,
      envelope: decodeSymmetricKeyEnvelopeV2(
        fromBase64Url(payload.slice("OCK2:".length)),
      ),
    }
  }
  if (payload.startsWith("OCM2:")) {
    return { kind: "pq-message" as const, envelope: getLastPqEnvelope() }
  }
  if (payload.startsWith("OCA2:")) {
    return {
      kind: "sym-message" as const,
      envelope:
        getLastSymMessageEnvelope() ??
        ({
          version: 2,
          type: "sym-message",
          suite: "HKDF-SHA256+A256GCM",
          keyId: payload.slice("OCA2:".length),
          createdAt: 1_723_000_000_001,
          iv: new Uint8Array(12),
          ciphertext: new Uint8Array(16),
        } satisfies SymMessageEnvelopeV2),
    }
  }
  if (payload.startsWith("OCI2:")) {
    return {
      kind: "pq-public-identity" as const,
      envelope:
        getLastPublicBundle() ?? buildPublicBundle(fakeIdentities[0]!),
    }
  }
  throw new AppError("INVALID_QR_PREFIX")
})
export const payloadSha256Hex = vi.fn(async (payload: string) =>
  encoder.encode(payload).byteLength.toString(16).padStart(64, "0"),
)
export const renderQrDataUrl = vi.fn(
  async (payload: string) => `data:image/png;base64,${btoa(payload)}`,
)
export const renderQrSvgString = vi.fn(
  async () => "<svg viewBox='0 0 1 1'/>",
)

export const encodeUnsignedMessageBodyV2 = vi.fn(
  (body: { plaintext: Uint8Array }) =>
    new Uint8Array(body.plaintext.byteLength + 96),
)
export const encodeSignedMessageV2 = vi.fn(
  (message: {
    body: { plaintext: Uint8Array }
    signature: { value: Uint8Array }
  }) =>
    new Uint8Array(
      message.body.plaintext.byteLength +
        message.signature.value.byteLength +
        128,
    ),
)
export const encodeMlKemEnvelopeV2 = vi.fn(
  (envelope: MlKemMessageEnvelopeV2) =>
    new Uint8Array(
      envelope.kemCiphertext.byteLength +
        envelope.ciphertext.byteLength +
        128,
    ),
)
export const decodeMlKemEnvelopeV2 = vi.fn(() => getLastPqEnvelope())
export const encodeSymMessageEnvelopeV2 = vi.fn(
  (envelope: SymMessageEnvelopeV2) => {
    setLastSymMessageEnvelope(envelope)
    return new Uint8Array(
      SYM_MESSAGE_OVERHEAD_BYTES + envelope.ciphertext.byteLength,
    )
  },
)
export const decodeSymMessageEnvelopeV2 = vi.fn(() => {
  const envelope = getLastSymMessageEnvelope()
  if (envelope === null) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  return envelope
})
export const encodeSymmetricKeyEnvelopeV2 = vi.fn<
  (envelope: SymmetricKeyEnvelopeV2) => Uint8Array
>()
export const decodeSymmetricKeyEnvelopeV2 = vi.fn<
  (bytes: Uint8Array) => SymmetricKeyEnvelopeV2
>()
export const encodePublicIdentityBundleV2 = vi.fn(
  (bundle: PublicIdentityBundleV2) => {
    setLastPublicBundle(bundle)
    return new Uint8Array(3_400)
  },
)
export const decodePublicIdentityBundleV2 = vi.fn(
  () => getLastPublicBundle() ?? buildPublicBundle(fakeIdentities[0]!),
)

// Mirrors the sole generation mode: uniform chunks and a possibly shorter tail.
export const splitIntoFrames = vi.fn(
  async ({
    artifactType,
    artifactBytes,
    frameBytes,
  }: {
    artifactType: V2ArtifactType
    artifactBytes: Uint8Array
    frameBytes: number
  }): Promise<QrFrameV2[]> => {
    if (artifactBytes.byteLength > MAX_ARTIFACT_BYTES_ABSOLUTE) {
      throw new AppError("QR_TOO_LARGE")
    }
    const frameCount = Math.max(
      1,
      Math.ceil(artifactBytes.byteLength / frameBytes),
    )
    let offset = 0
    return Array.from({ length: frameCount }, (_, frameIndex) => {
      const frame: QrFrameV2 = {
        version: 2,
        type: "qr-frame",
        transferId: new Uint8Array(16).fill(3),
        artifactType,
        frameIndex,
        frameCount,
        totalByteLength: artifactBytes.byteLength,
        chunk: artifactBytes.slice(offset, offset + frameBytes),
      }
      offset += frameBytes
      return frame
    })
  },
)

export function multipartPayload(
  transfer: string,
  index: number,
  count: number,
  artifactType: V2ArtifactType = "pq-public-identity",
): string {
  return `OCF2:${transfer}:${index}:${count}:${artifactType}`
}

let nextMultipartAddGate: Promise<void> | null = null
let nextMultipartArtifactBytes: Uint8Array | null = null

export function deferNextMultipartAdd(gate: Promise<void>): void {
  nextMultipartAddGate = gate
}

export function setNextMultipartArtifactBytes(bytes: Uint8Array): void {
  nextMultipartArtifactBytes = bytes.slice()
}

export class FakeTransferAssembler {
  readonly #timeoutMs: number
  #transfer: string | null = null
  #artifactType: V2ArtifactType = "pq-public-identity"
  #count = 0
  #received = new Set<number>()
  #expiresAt = 0
  #terminal: TransferState | null = null

  constructor(options: { transferTimeoutMinutes: number }) {
    this.#timeoutMs = options.transferTimeoutMinutes * 60_000
  }

  async add(payload: string): Promise<TransferState> {
    const gate = nextMultipartAddGate
    nextMultipartAddGate = null
    if (gate !== null) await gate
    if (this.#terminal) return this.#terminal
    const match = /^OCF2:([^:]+):(\d+):(\d+):(.+)$/u.exec(payload)
    if (!match) return this.#fail("INVALID_QR_PAYLOAD")
    const transfer = match[1]!
    const index = Number(match[2])
    const count = Number(match[3])
    const artifactType = match[4] as V2ArtifactType
    if (this.#transfer === null) {
      this.#transfer = transfer
      this.#artifactType = artifactType
      this.#count = count
      this.#expiresAt = Date.now() + this.#timeoutMs
    } else if (
      transfer !== this.#transfer ||
      count !== this.#count ||
      artifactType !== this.#artifactType
    ) {
      return this.#fail("FRAME_MISMATCH")
    }
    this.#received.add(index)
    if (this.#received.size === this.#count) {
      const artifactBytes =
        nextMultipartArtifactBytes?.slice() ?? Uint8Array.of(this.#count)
      nextMultipartArtifactBytes = null
      this.#terminal = {
        kind: "complete",
        transferId: encoder.encode(transfer).slice(0, 16),
        artifactType: this.#artifactType,
        artifactBytes,
      }
    }
    return this.state()
  }

  state(): TransferState {
    if (this.#terminal) return this.#terminal
    if (this.#transfer === null) return { kind: "idle" }
    if (Date.now() >= this.#expiresAt) {
      this.discard()
      return { kind: "idle" }
    }
    const missingIndexes = Array.from(
      { length: this.#count },
      (_, index) => index,
    ).filter((index) => !this.#received.has(index))
    return {
      kind: "collecting",
      transferId: encoder.encode(this.#transfer).slice(0, 16),
      artifactType: this.#artifactType,
      frameCount: this.#count,
      receivedIndexes: new Set(this.#received),
      missingIndexes,
      expiresAt: this.#expiresAt,
    }
  }

  discard(): void {
    this.#transfer = null
    this.#count = 0
    this.#received.clear()
    this.#terminal = null
  }

  #fail(code: ErrorCode): TransferState {
    this.#terminal = { kind: "error", code }
    return this.#terminal
  }
}

registerFakeReset(() => {
  resetWireState()
  nextMultipartAddGate = null
  nextMultipartArtifactBytes = null
})
