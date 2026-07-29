import { AppError } from "@/crypto/errors"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_FRAME_PAYLOAD_CHARS,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { decodePayload, encodeEnvelopeToPayload, QR_PREFIX } from "@/qr/payload"
import { decodeFramePayload, QR_PREFIX_V2 } from "@/qr/payload-v2"
import type { QrFrameV2 } from "@/schemas/domain"

export const RELAY_TEXT_MAX_CHARS = PROTOCOL_MAX_FRAMES * (MAX_FRAME_PAYLOAD_CHARS + 2)

export type RelayParseErrorCode =
  | "empty"
  | "frame-count"
  | "input-size"
  | "invalid-frame"
  | "invalid-message"
  | "kind-mismatch"
  | "length"
  | "message-count"
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
      kind: "frames"
      set: RelayFrameSet
      frames: readonly QrFrameV2[]
      originals: readonly string[]
    }
  | { ok: true; kind: "message"; payload: string }
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
    if (!original.startsWith(QR_PREFIX_V2.frame)) {
      return { ok: false, code: "prefix" }
    }

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

/**
 * The relay's entire allowlist, in one place. Exactly two prefixes reach a
 * parser; every other prefix stops here, including the OCK1 symmetric key and
 * the OCP1 public key. Rejecting those prefixes is not a guarantee that no key
 * material crosses the relay. Accepted OCF2 chunks and every sender-controlled
 * OCM1 field (`keyId`, `createdAt`, `iv`, `ciphertext`, and `aad`) are untrusted;
 * the offline endpoint is the only authentication boundary (threat-model T21).
 */
function classifyRelayLine(text: string): "message" | "frames" | null {
  if (text.startsWith(QR_PREFIX.message)) return "message"
  if (text.startsWith(QR_PREFIX_V2.frame)) return "frames"
  return null
}

export type RelayMessageParseResult =
  | { ok: true; payload: string }
  | { ok: false; code: RelayParseErrorCode }

/**
 * A single canonical v1 AES message. Decoding is purely structural — CBOR shape
 * and strict schema, never a key, an AEAD operation, or an AAD recomputation.
 * Requiring the canonical re-encode to reproduce the input byte for byte means a
 * non-canonical encoding can never be forwarded to the offline endpoint.
 */
export function parseRelayMessage(text: string): RelayMessageParseResult {
  if (classifyRelayLine(text) !== "message") {
    return { ok: false, code: "prefix" }
  }
  try {
    const decoded = decodePayload(text)
    if (decoded.kind !== "message") {
      return { ok: false, code: "invalid-message" }
    }
    if (encodeEnvelopeToPayload(decoded.envelope) !== text) {
      return { ok: false, code: "invalid-message" }
    }
    return { ok: true, payload: text }
  } catch {
    return { ok: false, code: "invalid-message" }
  }
}

type ValidatedRelayLine =
  | { ok: true; kind: "message"; payload: string }
  | { ok: true; kind: "frames"; set: RelayFrameSet }
  | { ok: false; code: RelayParseErrorCode }

function validateRelayLine(original: string): ValidatedRelayLine {
  const kind = classifyRelayLine(original)
  if (kind === null) return { ok: false, code: "prefix" }
  if (kind === "message") {
    const parsed = parseRelayMessage(original)
    return parsed.ok
      ? { ok: true, kind: "message", payload: parsed.payload }
      : parsed
  }
  const parsed = parseRelayFrameSet([original])
  return parsed.ok ? { ok: true, kind: "frames", set: parsed.set } : parsed
}

export type RelayCapture =
  | { kind: null }
  | { kind: "frames"; set: RelayFrameSet }
  | { kind: "message"; payload: string }

export const EMPTY_RELAY_CAPTURE: RelayCapture = { kind: null }

export type RelayCaptureResult =
  | { ok: true; capture: RelayCapture }
  | { ok: false; code: RelayParseErrorCode }

/**
 * The camera boundary. The first accepted payload fixes the session kind; the
 * other kind is then refused without discarding what was already accepted. A
 * forbidden or foreign prefix stays a prefix error — "kind mismatch" is reserved
 * for input that really is the other allowed kind.
 */
export function acceptRelayCapture(
  original: string,
  current: RelayCapture,
): RelayCaptureResult {
  const candidate = validateRelayLine(original)
  if (!candidate.ok) return candidate
  if (current.kind !== null && current.kind !== candidate.kind) {
    return { ok: false, code: "kind-mismatch" }
  }

  if (candidate.kind === "message") {
    if (current.kind === "message" && current.payload !== candidate.payload) {
      return { ok: false, code: "mismatch" }
    }
    return {
      ok: true,
      capture: { kind: "message", payload: candidate.payload },
    }
  }

  if (current.kind === null) {
    return { ok: true, capture: { kind: "frames", set: candidate.set } }
  }
  if (current.kind !== "frames") {
    return { ok: false, code: "kind-mismatch" }
  }
  const previous = current.set
  const parsed = parseRelayFrameSet([original], previous)
  if (!parsed.ok) return parsed
  return { ok: true, capture: { kind: "frames", set: parsed.set } }
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
  if (originals.some((original) => classifyRelayLine(original) === null)) {
    return { ok: false, code: "prefix" }
  }

  const validated: ValidatedRelayLine[] = []
  for (const original of originals) {
    const candidate = validateRelayLine(original)
    if (!candidate.ok) return candidate
    validated.push(candidate)
  }

  const messages = validated.filter(
    (candidate): candidate is Extract<ValidatedRelayLine, { kind: "message" }> =>
      candidate.ok && candidate.kind === "message",
  )
  if (messages.length > 1) {
    return { ok: false, code: "message-count" }
  }
  if (
    messages.length === 1 &&
    validated.some((candidate) => candidate.ok && candidate.kind === "frames")
  ) {
    return { ok: false, code: "kind-mismatch" }
  }
  if (messages[0] !== undefined) {
    return { ok: true, kind: "message", payload: messages[0].payload }
  }

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
    kind: "frames",
    set: parsed.set,
    frames: ordered.map(({ frame }) => frame),
    originals: ordered.map(({ original }) => original),
  }
}
