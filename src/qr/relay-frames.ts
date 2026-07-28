import { AppError } from "@/crypto/errors"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_FRAME_PAYLOAD_CHARS,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { decodeFramePayload } from "@/qr/payload-v2"
import type { QrFrameV2 } from "@/schemas/domain"

export const RELAY_TEXT_MAX_CHARS = PROTOCOL_MAX_FRAMES * (MAX_FRAME_PAYLOAD_CHARS + 2)

export type RelayParseErrorCode =
  | "empty"
  | "frame-count"
  | "input-size"
  | "invalid-frame"
  | "length"
  | "mismatch"
  | "outer-type"
  | "prefix"

interface RelayMetadata {
  readonly transferId: Uint8Array
  readonly artifactType: "pq-message"
  readonly frameCount: number
  readonly totalByteLength: number
}

export interface RelayFrameEntry {
  readonly frame: QrFrameV2
  readonly original: string
}

export interface RelayFrameSet {
  readonly metadata: RelayMetadata | null
  readonly entries: ReadonlyMap<number, RelayFrameEntry>
  readonly receivedByteLength: number
}

export type RelayParseResult =
  { ok: true; set: RelayFrameSet } | { ok: false; code: RelayParseErrorCode }

export type RelayTextParseResult =
  | {
      ok: true
      set: RelayFrameSet
      frames: readonly QrFrameV2[]
      originals: readonly string[]
    }
  | {
      ok: false
      code: RelayParseErrorCode
      missingIndexes?: readonly number[]
    }

export function emptyRelayFrameSet(): RelayFrameSet {
  return {
    metadata: null,
    entries: new Map(),
    receivedByteLength: 0,
  }
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  let difference = 0
  for (let index = 0; index < left.byteLength; index += 1) {
    difference |= left[index]! ^ right[index]!
  }
  return difference === 0
}

function metadataMatches(metadata: RelayMetadata, frame: QrFrameV2): boolean {
  return (
    bytesEqual(metadata.transferId, frame.transferId) &&
    metadata.artifactType === frame.artifactType &&
    metadata.frameCount === frame.frameCount &&
    metadata.totalByteLength === frame.totalByteLength
  )
}

function parserError(error: unknown): RelayParseErrorCode {
  return error instanceof AppError && error.code === "INVALID_QR_PREFIX"
    ? "prefix"
    : "invalid-frame"
}

function validFrameLengths(frame: QrFrameV2): boolean {
  return (
    frame.totalByteLength <= frame.frameCount * FRAME_CHUNK_MAX_BYTES &&
    (frame.frameCount !== 1 || frame.chunk.byteLength === frame.totalByteLength)
  )
}

/**
 * Pure, bounded parser shared by camera capture and text playback. The caller's
 * accepted set is never mutated; a failed batch has no commit side effect.
 */
export function parseRelayFrameSet(
  originals: readonly string[],
  initial: RelayFrameSet = emptyRelayFrameSet(),
): RelayParseResult {
  if (originals.length === 0) return { ok: false, code: "empty" }
  if (originals.length > PROTOCOL_MAX_FRAMES) {
    return { ok: false, code: "frame-count" }
  }

  let metadata = initial.metadata
  let receivedByteLength = initial.receivedByteLength
  const entries = new Map(initial.entries)

  for (const original of originals) {
    if (!original.startsWith("OCF2:")) return { ok: false, code: "prefix" }

    let frame: QrFrameV2
    try {
      frame = decodeFramePayload(original)
    } catch (error) {
      return { ok: false, code: parserError(error) }
    }

    if (frame.artifactType !== "pq-message") {
      return { ok: false, code: "outer-type" }
    }
    if (!validFrameLengths(frame)) return { ok: false, code: "length" }

    if (metadata === null) {
      metadata = {
        transferId: Uint8Array.from(frame.transferId),
        artifactType: "pq-message",
        frameCount: frame.frameCount,
        totalByteLength: frame.totalByteLength,
      }
    } else if (!metadataMatches(metadata, frame)) {
      return { ok: false, code: "mismatch" }
    }

    const occupied = entries.get(frame.frameIndex)
    if (occupied !== undefined) {
      if (occupied.original !== original) {
        return { ok: false, code: "mismatch" }
      }
      continue
    }

    const nextByteLength = receivedByteLength + frame.chunk.byteLength
    if (
      !Number.isSafeInteger(nextByteLength) ||
      nextByteLength > metadata.totalByteLength
    ) {
      return { ok: false, code: "length" }
    }
    entries.set(frame.frameIndex, { frame, original })
    receivedByteLength = nextByteLength
  }

  if (
    metadata !== null &&
    entries.size === metadata.frameCount &&
    receivedByteLength !== metadata.totalByteLength
  ) {
    return { ok: false, code: "length" }
  }

  return {
    ok: true,
    set: { metadata, entries, receivedByteLength },
  }
}

export function missingRelayIndexes(set: RelayFrameSet): number[] {
  if (set.metadata === null) return []
  const missing: number[] = []
  for (let index = 0; index < set.metadata.frameCount; index += 1) {
    if (!set.entries.has(index)) missing.push(index)
  }
  return missing
}

export function orderedRelayEntries(set: RelayFrameSet): RelayFrameEntry[] {
  return [...set.entries.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, entry]) => entry)
}

export function parseRelayText(text: string): RelayTextParseResult {
  if (text.length > RELAY_TEXT_MAX_CHARS) {
    return { ok: false, code: "input-size" }
  }
  const originals = text
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line))
    .filter((line) => line.length > 0)
  if (originals.length === 0) return { ok: false, code: "empty" }
  if (originals.length > PROTOCOL_MAX_FRAMES) {
    return { ok: false, code: "frame-count" }
  }

  const parsed = parseRelayFrameSet(originals)
  if (!parsed.ok) return parsed
  const missingIndexes = missingRelayIndexes(parsed.set)
  if (missingIndexes.length > 0) {
    return { ok: false, code: "frame-count", missingIndexes }
  }
  const ordered = orderedRelayEntries(parsed.set)
  return {
    ok: true,
    set: parsed.set,
    frames: ordered.map(({ frame }) => frame),
    originals: ordered.map(({ original }) => original),
  }
}
