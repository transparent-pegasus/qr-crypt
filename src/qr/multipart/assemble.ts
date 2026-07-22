// OCF2 フレーム組立(spec2 §12、plan2.1 §D4 — WP-12)。
//
// 不変条件(凍結):
//   - index は 0..frameCount-1。first frame で immutable metadata
//     (transferId/artifactType/frameCount/totalByteLength/payloadSha256)を凍結
//   - 同 index は「完全一致」のみ idempotent duplicate として無視。
//     1 byte でも差異 → FRAME_MISMATCH(session 汚染扱い)
//   - 別 transferId 混入 → FRAME_MISMATCH
//   - 完成時: index coverage・合計長 = totalByteLength・
//     SHA-256(artifact 生バイト) = payloadSha256・artifactType と復元 artifact
//     の type 一致 を検証してから complete へ遷移
//   - SHA-256 は転送整合性であり送信者 authenticity ではない(UI 表示注意)
//   - タイムアウト(expiresAt)/明示破棄/完成/エラーで chunk state を解放
import type { ErrorCode } from "@/crypto/errors"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"
import { decodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"
import { bytesEqual, sha256 } from "@/lib/bytes"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  TRANSFER_TIMEOUT_MINUTES_MAX,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { validateQrFrameV2Strict } from "@/qr/multipart/frame-schema"
import type { TransferState } from "@/qr/multipart/transfer-state"
import { decodeFramePayload } from "@/qr/payload-v2"
import { V2_ARTIFACT_TYPES } from "@/schemas/domain"

export interface TransferAssemblerOptions {
  transferTimeoutMinutes: number
  now?: () => number // テスト用 seam(既定 Date.now)
}

interface TransferMetadata {
  transferId: Uint8Array
  artifactType: V2ArtifactType
  frameCount: number
  totalByteLength: number
  payloadSha256: Uint8Array
}

interface ActiveTransfer {
  metadata: TransferMetadata
  chunks: Map<number, Uint8Array>
  expiresAt: number
}

type TerminalTransferState = Extract<TransferState, { kind: "complete" | "error" }>

function metadataMatches(metadata: TransferMetadata, frame: QrFrameV2): boolean {
  return (
    bytesEqual(metadata.transferId, frame.transferId) &&
    metadata.artifactType === frame.artifactType &&
    metadata.frameCount === frame.frameCount &&
    metadata.totalByteLength === frame.totalByteLength &&
    bytesEqual(metadata.payloadSha256, frame.payloadSha256)
  )
}

function artifactTypeFromBytes(artifactBytes: Uint8Array): V2ArtifactType {
  const artifact = decodeCanonicalCbor(artifactBytes)
  if (
    typeof artifact !== "object" ||
    artifact === null ||
    artifact instanceof Uint8Array
  ) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  const type = (artifact as Record<string, unknown>)["type"]
  if (
    typeof type !== "string" ||
    !(V2_ARTIFACT_TYPES as readonly string[]).includes(type)
  ) {
    throw new AppError("INVALID_QR_PAYLOAD")
  }
  if (type === "encrypted-seed-backup") {
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  return type as V2ArtifactType
}

export class TransferAssembler {
  readonly #timeoutMilliseconds: number
  readonly #now: () => number
  #active: ActiveTransfer | undefined
  #terminal: TerminalTransferState | undefined

  constructor(options: TransferAssemblerOptions) {
    if (
      !Number.isSafeInteger(options.transferTimeoutMinutes) ||
      options.transferTimeoutMinutes < TRANSFER_TIMEOUT_MINUTES_MIN ||
      options.transferTimeoutMinutes > TRANSFER_TIMEOUT_MINUTES_MAX
    ) {
      throw new RangeError("transferTimeoutMinutes out of range")
    }
    this.#timeoutMilliseconds = options.transferTimeoutMinutes * 60_000
    this.#now = options.now ?? Date.now
  }

  // フレーム文字列(OCF2:…)を 1 枚受け取り、遷移後の状態を返す
  async add(frameText: string): Promise<TransferState> {
    if (this.#expireIfNeeded()) return { kind: "idle" }
    if (this.#terminal !== undefined) return this.state()

    let frame: QrFrameV2
    try {
      frame = validateQrFrameV2Strict(decodeFramePayload(frameText))
    } catch (error) {
      return this.#fail(error instanceof AppError ? error.code : "INVALID_QR_PAYLOAD")
    }

    if (frame.artifactType === "encrypted-seed-backup") {
      return this.#fail("UNSUPPORTED_ALGORITHM")
    }
    if (
      frame.totalByteLength > MAX_ARTIFACT_BYTES_ABSOLUTE ||
      frame.totalByteLength > frame.frameCount * FRAME_CHUNK_MAX_BYTES
    ) {
      return this.#fail("INVALID_QR_PAYLOAD")
    }

    if (this.#active === undefined) {
      const startedAt = this.#now()
      if (!Number.isSafeInteger(startedAt) || startedAt < 0) {
        return this.#fail("INVALID_QR_PAYLOAD")
      }
      const expiresAt = startedAt + this.#timeoutMilliseconds
      if (!Number.isSafeInteger(expiresAt)) {
        return this.#fail("INVALID_QR_PAYLOAD")
      }
      this.#active = {
        metadata: {
          transferId: Uint8Array.from(frame.transferId),
          artifactType: frame.artifactType,
          frameCount: frame.frameCount,
          totalByteLength: frame.totalByteLength,
          payloadSha256: Uint8Array.from(frame.payloadSha256),
        },
        chunks: new Map(),
        expiresAt,
      }
    } else if (!metadataMatches(this.#active.metadata, frame)) {
      return this.#fail("FRAME_MISMATCH")
    }

    const active = this.#active
    const existingChunk = active.chunks.get(frame.frameIndex)
    if (existingChunk !== undefined) {
      if (!bytesEqual(existingChunk, frame.chunk)) {
        return this.#fail("FRAME_MISMATCH")
      }
      return this.state()
    }

    active.chunks.set(frame.frameIndex, Uint8Array.from(frame.chunk))
    let receivedByteLength = 0
    for (const chunk of active.chunks.values()) {
      receivedByteLength += chunk.byteLength
      if (
        !Number.isSafeInteger(receivedByteLength) ||
        receivedByteLength > active.metadata.totalByteLength
      ) {
        return this.#fail("INVALID_QR_PAYLOAD")
      }
    }
    if (active.chunks.size < active.metadata.frameCount) return this.state()

    if (receivedByteLength !== active.metadata.totalByteLength) {
      return this.#fail("INVALID_QR_PAYLOAD")
    }
    const artifactBytes = new Uint8Array(receivedByteLength)
    let offset = 0
    for (let frameIndex = 0; frameIndex < active.metadata.frameCount; frameIndex += 1) {
      const chunk = active.chunks.get(frameIndex)
      if (chunk === undefined) return this.#fail("INVALID_QR_PAYLOAD")
      artifactBytes.set(chunk, offset)
      offset += chunk.byteLength
    }

    let actualHash: Uint8Array
    try {
      actualHash = await sha256(artifactBytes)
    } catch {
      if (this.#active !== active) return this.state()
      return this.#fail("INVALID_QR_PAYLOAD")
    }
    // discard/error/別の完了検証が digest 待ち中に状態を変えた場合、復活させない。
    if (this.#active !== active) return this.state()
    if (!bytesEqual(actualHash, active.metadata.payloadSha256)) {
      return this.#fail("INVALID_QR_PAYLOAD")
    }

    let restoredArtifactType: V2ArtifactType
    try {
      restoredArtifactType = artifactTypeFromBytes(artifactBytes)
    } catch (error) {
      return this.#fail(error instanceof AppError ? error.code : "INVALID_QR_PAYLOAD")
    }
    if (restoredArtifactType !== active.metadata.artifactType) {
      return this.#fail("INVALID_QR_PAYLOAD")
    }

    const complete: TerminalTransferState = {
      kind: "complete",
      transferId: Uint8Array.from(active.metadata.transferId),
      artifactType: active.metadata.artifactType,
      artifactBytes: Uint8Array.from(artifactBytes),
    }
    active.chunks.clear()
    this.#active = undefined
    this.#terminal = complete
    return this.state()
  }

  state(): TransferState {
    this.#expireIfNeeded()
    if (this.#terminal?.kind === "error") return { ...this.#terminal }
    if (this.#terminal?.kind === "complete") {
      return {
        ...this.#terminal,
        transferId: Uint8Array.from(this.#terminal.transferId),
        artifactBytes: Uint8Array.from(this.#terminal.artifactBytes),
      }
    }
    if (this.#active === undefined) return { kind: "idle" }

    const receivedIndexes = [...this.#active.chunks.keys()].sort((a, b) => a - b)
    const receivedSet = new Set(receivedIndexes)
    const missingIndexes: number[] = []
    for (let index = 0; index < this.#active.metadata.frameCount; index += 1) {
      if (!receivedSet.has(index)) missingIndexes.push(index)
    }
    return {
      kind: "collecting",
      transferId: Uint8Array.from(this.#active.metadata.transferId),
      artifactType: this.#active.metadata.artifactType,
      frameCount: this.#active.metadata.frameCount,
      receivedIndexes: receivedSet,
      missingIndexes,
      expiresAt: this.#active.expiresAt,
    }
  }

  // 明示破棄(読取 UI の「破棄」ボタン・unmount・タイムアウト処理から)
  discard(): void {
    this.#releaseActive()
    this.#terminal = undefined
  }

  #fail(code: ErrorCode): TransferState {
    this.#releaseActive()
    this.#terminal = { kind: "error", code }
    return { ...this.#terminal }
  }

  #releaseActive(): void {
    this.#active?.chunks.clear()
    this.#active = undefined
  }

  #expireIfNeeded(): boolean {
    if (this.#active !== undefined && this.#now() >= this.#active.expiresAt) {
      this.#releaseActive()
      return true
    }
    return false
  }
}
