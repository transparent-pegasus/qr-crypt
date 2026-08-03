import { describe, expect, expectTypeOf, it } from "vitest"
import {
  encodeCanonicalCbor,
  encodeMlKemEnvelopeV2,
  encodeSymMessageEnvelopeV2,
  type CanonicalCborValue,
} from "@/crypto/pq/canonical-cbor"
import { toBase64Url } from "@/lib/base64url"
import { FRAME_BYTES_MAX, PROTOCOL_MAX_FRAMES } from "@/lib/limits"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import {
  acceptRelayCapture,
  EMPTY_RELAY_CAPTURE,
  parseRelayFrameSet,
  parseRelayText,
  RELAY_TEXT_MAX_CHARS,
  type RelayCapture,
  type RelayFrameSet,
  type RelayParseErrorCode,
} from "@/qr/relay-frames"
import type {
  MlKemMessageEnvelopeV2,
  QrFrameV2,
  SymMessageEnvelopeV2,
  V2ArtifactType,
} from "@/schemas/domain"
import { OCM1_MESSAGE_33, OCM1_MESSAGE_44 } from "../fixtures/relay-legacy"

const KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const TRANSFER_ID = new Uint8Array(16).fill(0x11)

function pqMessageEnvelope(): MlKemMessageEnvelopeV2 {
  return {
    version: 2,
    type: "pq-message",
    suite: "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM",
    recipientKemKeyId: KEY_ID,
    kemCiphertext: new Uint8Array(1_568).fill(0x31),
    iv: new Uint8Array(12).fill(0x33),
    ciphertext: new Uint8Array(16).fill(0x34),
  }
}

function symMessageEnvelope(): SymMessageEnvelopeV2 {
  return {
    version: 2,
    type: "sym-message",
    suite: "HKDF-SHA256+A256GCM",
    keyId: KEY_ID,
    createdAt: 1_700_000_000_000,
    iv: new Uint8Array(12).fill(0x42),
    ciphertext: new Uint8Array(16).fill(0x43),
  }
}

const PQ_MESSAGE_BYTES = encodeMlKemEnvelopeV2(pqMessageEnvelope())
const SYM_MESSAGE_BYTES = encodeSymMessageEnvelopeV2(symMessageEnvelope())

function artifactFrames(
  artifactType: "pq-message" | "sym-message",
  artifactBytes: Uint8Array,
  options: { frameBytes?: number; transferId?: Uint8Array } = {},
): QrFrameV2[] {
  const frameBytes = options.frameBytes ?? FRAME_BYTES_MAX
  const frameCount = Math.ceil(artifactBytes.byteLength / frameBytes)
  const transferId = options.transferId ?? TRANSFER_ID
  return Array.from({ length: frameCount }, (_, frameIndex) => ({
    version: 2,
    type: "qr-frame",
    transferId: Uint8Array.from(transferId),
    artifactType,
    frameIndex,
    frameCount,
    totalByteLength: artifactBytes.byteLength,
    chunk: artifactBytes.slice(
      frameIndex * frameBytes,
      Math.min((frameIndex + 1) * frameBytes, artifactBytes.byteLength),
    ),
  }))
}

const PQ_FRAMES = artifactFrames("pq-message", PQ_MESSAGE_BYTES)
const SYM_FRAMES = artifactFrames("sym-message", SYM_MESSAGE_BYTES)

function cloneFrame(frame: QrFrameV2, overrides: Partial<QrFrameV2> = {}): QrFrameV2 {
  return {
    ...frame,
    transferId: Uint8Array.from(frame.transferId),
    chunk: Uint8Array.from(frame.chunk),
    ...overrides,
  }
}

function pqFrame(frameIndex: number, overrides: Partial<QrFrameV2> = {}): QrFrameV2 {
  const source = PQ_FRAMES[frameIndex]
  if (source === undefined) throw new Error(`missing PQ frame ${frameIndex}`)
  return cloneFrame(source, overrides)
}

function pqPayload(frameIndex: number, overrides: Partial<QrFrameV2> = {}): string {
  return encodeFrameToPayload(pqFrame(frameIndex, overrides))
}

function symPayload(overrides: Partial<QrFrameV2> = {}): string {
  const source = SYM_FRAMES[0]
  if (source === undefined) throw new Error("missing symmetric frame")
  return encodeFrameToPayload(cloneFrame(source, overrides))
}

function payloads(frames: readonly QrFrameV2[]): string[] {
  return frames.map(encodeFrameToPayload)
}

function invalidMessageFrames(artifactType: "pq-message" | "sym-message"): string[] {
  const bytes = encodeCanonicalCbor({ version: 2, type: artifactType })
  return payloads(
    artifactFrames(artifactType, bytes, {
      frameBytes: Math.ceil(bytes.byteLength / 2),
      transferId: new Uint8Array(16).fill(artifactType === "pq-message" ? 0x51 : 0x52),
    }),
  )
}

function concatBytes(parts: readonly Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.byteLength, 0))
  let offset = 0
  for (const part of parts) {
    output.set(part, offset)
    offset += part.byteLength
  }
  return output
}

function nonCanonicalFramePayload(frame: QrFrameV2): string {
  const entries: readonly [string, CanonicalCborValue][] = [
    ["version", frame.version],
    ["type", frame.type],
    ["transferId", frame.transferId],
    ["artifactType", frame.artifactType],
    ["frameIndex", frame.frameIndex],
    ["frameCount", frame.frameCount],
    ["totalByteLength", frame.totalByteLength],
    ["chunk", frame.chunk],
  ]
  const encodedEntries = entries.map(([key, value]) =>
    encodeCanonicalCbor({ [key]: value }).subarray(1),
  )
  return `OCF2:${toBase64Url(concatBytes([Uint8Array.of(0xa8), ...encodedEntries]))}`
}

type ExpectedRelayParseErrorCode =
  | "empty"
  | "frame-count"
  | "input-size"
  | "invalid-frame"
  | "kind-mismatch"
  | "length"
  | "mismatch"
  | "outer-type"
  | "prefix"

type ExpectedRelayCapture = { kind: null } | { kind: "frames"; set: RelayFrameSet }

interface RelayContractModule {
  RELAY_ARTIFACT_TYPES?: ReadonlySet<V2ArtifactType>
  validateRelayArtifact?: (
    artifactType: "pq-message" | "sym-message",
    bytes: Uint8Array,
  ) => void
}

async function relayContract(): Promise<RelayContractModule> {
  return (await import("@/qr/relay-frames")) as RelayContractModule
}

describe("relay contract surface", () => {
  it("narrows the public error and capture unions to frames only", () => {
    expectTypeOf<RelayParseErrorCode>().toEqualTypeOf<ExpectedRelayParseErrorCode>()
    expectTypeOf<RelayCapture>().toEqualTypeOf<ExpectedRelayCapture>()
  })

  it("exports exactly the two message artifact types", async () => {
    const { RELAY_ARTIFACT_TYPES } = await relayContract()
    expect(RELAY_ARTIFACT_TYPES).toEqual(
      new Set<V2ArtifactType>(["pq-message", "sym-message"]),
    )
  })

  it.each([
    ["pq-message", PQ_MESSAGE_BYTES],
    ["sym-message", SYM_MESSAGE_BYTES],
  ] as const)("validates a canonical %s artifact", async (artifactType, bytes) => {
    const { validateRelayArtifact } = await relayContract()
    expect(validateRelayArtifact).toBeTypeOf("function")
    if (validateRelayArtifact === undefined) return
    expect(() => validateRelayArtifact(artifactType, bytes)).not.toThrow()
  })

  it.each(["pq-message", "sym-message"] as const)(
    "maps an invalid completed %s artifact to INVALID_QR_PAYLOAD",
    async (artifactType) => {
      const { validateRelayArtifact } = await relayContract()
      expect(validateRelayArtifact).toBeTypeOf("function")
      if (validateRelayArtifact === undefined) return
      const bytes = encodeCanonicalCbor({ version: 2, type: artifactType })
      expect(() => validateRelayArtifact(artifactType, bytes)).toThrowError(
        expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
      )
    },
  )
})

describe("relay frame-set parser", () => {
  it("accepts canonical pq-message and sym-message frame sets", () => {
    expect(PQ_FRAMES).toHaveLength(2)
    expect(SYM_FRAMES).toHaveLength(1)

    for (const frames of [PQ_FRAMES, SYM_FRAMES]) {
      const originals = payloads(frames)
      const parsed = parseRelayFrameSet(originals)
      expect(parsed.ok).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.set.metadata?.artifactType).toBe(frames[0]?.artifactType)
    }
  })

  it("orders out-of-order PQ frames and treats an exact duplicate idempotently", () => {
    const first = pqPayload(0)
    const second = pqPayload(1)
    const parsed = parseRelayFrameSet([second, first, second])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.set.entries.keys()].sort()).toEqual([0, 1])

    const roundTrip = parseRelayText(`${second}\r\n${first}\r\n`)
    expect(roundTrip).toMatchObject({ ok: true, kind: "frames" })
    if (!roundTrip.ok || roundTrip.kind !== "frames") return
    expect(roundTrip.originals).toEqual([first, second])
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual([first, second])
  })

  it.each([
    ["retired OCM1", OCM1_MESSAGE_33],
    ["bare OCA2", "OCA2:AA"],
    ["bare OCM2", "OCM2:AA"],
    ["bare OCK2", "OCK2:AA"],
    ["retired OCP2", "OCP2:AA"],
    ["retired OCS2", "OCS2:AA"],
    ["bare OCI2", "OCI2:AA"],
    ["reserved OCB2", "OCB2:AA"],
    ["foreign", "https://example.invalid/"],
  ])("rejects %s as a foreign prefix without changing state", (_label, input) => {
    const initial = parseRelayFrameSet([pqPayload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(parseRelayFrameSet([input], initial.set)).toEqual({
      ok: false,
      code: "prefix",
    })
    expect(initial.set.entries.size).toBe(1)
  })

  it.each([
    "symmetric-key",
    "pq-public-identity",
    "encrypted-seed-backup",
  ] satisfies V2ArtifactType[])('rejects wrong outer type "%s"', (artifactType) => {
    const original = encodeFrameToPayload({
      version: 2,
      type: "qr-frame",
      transferId: Uint8Array.from(TRANSFER_ID),
      artifactType,
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: 1,
      chunk: Uint8Array.of(1),
    })
    expect(parseRelayFrameSet([original])).toEqual({
      ok: false,
      code: "outer-type",
    })
  })

  it("reports pq-message and sym-message frames in one session as a mismatch", () => {
    expect(parseRelayFrameSet([pqPayload(0), symPayload()])).toEqual({
      ok: false,
      code: "mismatch",
    })
  })

  it.each([
    [
      "transferId",
      { transferId: new Uint8Array(16).fill(0x33) } satisfies Partial<QrFrameV2>,
    ],
    ["frameCount", { frameCount: 3 } satisfies Partial<QrFrameV2>],
    [
      "totalByteLength",
      { totalByteLength: PQ_MESSAGE_BYTES.byteLength + 1 } satisfies Partial<QrFrameV2>,
    ],
  ] as const)("rejects a %s metadata mismatch atomically", (_label, overrides) => {
    const initial = parseRelayFrameSet([pqPayload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const before = initial.set
    expect(parseRelayFrameSet([pqPayload(1, overrides)], before)).toEqual({
      ok: false,
      code: "mismatch",
    })
    expect(before.entries.size).toBe(1)
    expect(before.receivedByteLength).toBe(PQ_FRAMES[0]?.chunk.byteLength)
  })

  it("rejects a conflicting duplicate without overwriting the accepted frame", () => {
    const original = pqPayload(0)
    const initial = parseRelayFrameSet([original])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const changedChunk = Uint8Array.from(PQ_FRAMES[0]!.chunk)
    changedChunk[0] = changedChunk[0]! ^ 0xff
    const conflict = pqPayload(0, { chunk: changedChunk })
    expect(parseRelayFrameSet([conflict], initial.set)).toEqual({
      ok: false,
      code: "mismatch",
    })
    expect(initial.set.entries.get(0)?.original).toBe(original)
  })

  it.each([
    [
      "declared total above frame capacity",
      [
        encodeFrameToPayload({
          version: 2,
          type: "qr-frame",
          transferId: Uint8Array.from(TRANSFER_ID),
          artifactType: "pq-message",
          frameIndex: 0,
          frameCount: 2,
          totalByteLength: FRAME_BYTES_MAX * 2 + 1,
          chunk: Uint8Array.of(1),
        }),
      ],
    ],
    [
      "single-frame chunk/total mismatch",
      [
        encodeFrameToPayload({
          version: 2,
          type: "qr-frame",
          transferId: Uint8Array.from(TRANSFER_ID),
          artifactType: "pq-message",
          frameIndex: 0,
          frameCount: 1,
          totalByteLength: 2,
          chunk: Uint8Array.of(1),
        }),
      ],
    ],
    [
      "completed sum below its declared total",
      [
        encodeFrameToPayload({
          version: 2,
          type: "qr-frame",
          transferId: Uint8Array.from(TRANSFER_ID),
          artifactType: "pq-message",
          frameIndex: 0,
          frameCount: 2,
          totalByteLength: 3,
          chunk: Uint8Array.of(1),
        }),
        encodeFrameToPayload({
          version: 2,
          type: "qr-frame",
          transferId: Uint8Array.from(TRANSFER_ID),
          artifactType: "pq-message",
          frameIndex: 1,
          frameCount: 2,
          totalByteLength: 3,
          chunk: Uint8Array.of(2),
        }),
      ],
    ],
  ])("rejects %s", (_label, originals) => {
    expect(parseRelayFrameSet(originals)).toEqual({
      ok: false,
      code: "length",
    })
  })

  it("rejects a structurally valid but non-canonical OCF2 frame", () => {
    expect(parseRelayFrameSet([nonCanonicalFramePayload(pqFrame(0))])).toEqual({
      ok: false,
      code: "invalid-frame",
    })
  })

  it("reports missing indexes for an incomplete playback set", () => {
    expect(parseRelayText(pqPayload(1))).toEqual({
      ok: false,
      code: "frame-count",
      missingIndexes: [0],
    })
  })

  it("rejects 129 non-empty lines and oversized raw text before decoding", () => {
    expect(
      parseRelayText(
        Array.from({ length: PROTOCOL_MAX_FRAMES + 1 }, () => pqPayload(0)).join("\n"),
      ),
    ).toEqual({ ok: false, code: "frame-count" })
    expect(parseRelayText("x".repeat(RELAY_TEXT_MAX_CHARS + 1))).toEqual({
      ok: false,
      code: "input-size",
    })
    expect(PROTOCOL_MAX_FRAMES).toBe(128)
    expect(RELAY_TEXT_MAX_CHARS).toBe(213_120)
  })

  it.each(["pq-message", "sym-message"] as const)(
    "rejects completed canonical %s bytes that fail the strict message schema",
    (artifactType) => {
      const originals = invalidMessageFrames(artifactType)
      expect(parseRelayFrameSet(originals)).toEqual({
        ok: false,
        code: "invalid-frame",
      })
      expect(parseRelayText(originals.join("\n"))).toEqual({
        ok: false,
        code: "invalid-frame",
      })
    },
  )
})

describe("relay capture and playback boundaries", () => {
  it("accepts a complete symmetric message frame for capture and playback", () => {
    const original = symPayload()
    const captured = acceptRelayCapture(original, EMPTY_RELAY_CAPTURE)
    expect(captured).toMatchObject({
      ok: true,
      capture: { kind: "frames" },
    })
    expect(parseRelayText(original)).toMatchObject({
      ok: true,
      kind: "frames",
      originals: [original],
    })
  })

  it.each([OCM1_MESSAGE_33, OCM1_MESSAGE_44])(
    "refuses retired OCM1 as a foreign prefix at both boundaries",
    (legacy) => {
      expect(acceptRelayCapture(legacy, EMPTY_RELAY_CAPTURE)).toEqual({
        ok: false,
        code: "prefix",
      })
      expect(parseRelayText(legacy)).toEqual({ ok: false, code: "prefix" })
    },
  )

  it.each(["OCA2:AA", "OCM2:AA", "OCK2:AA", "OCP2:AA", "OCS2:AA", "OCI2:AA"])(
    "refuses bare v2 payload %s at both boundaries",
    (bare) => {
      expect(acceptRelayCapture(bare, EMPTY_RELAY_CAPTURE)).toEqual({
        ok: false,
        code: "prefix",
      })
      expect(parseRelayText(bare)).toEqual({ ok: false, code: "prefix" })
    },
  )

  it("preserves an accepted PQ session when a symmetric frame mismatches", () => {
    const started = acceptRelayCapture(pqPayload(0), EMPTY_RELAY_CAPTURE)
    expect(started).toMatchObject({ ok: true, capture: { kind: "frames" } })
    if (!started.ok) return
    expect(acceptRelayCapture(symPayload(), started.capture)).toEqual({
      ok: false,
      code: "mismatch",
    })
    expect(started.capture).toMatchObject({ kind: "frames" })
  })

  it.each(["pq-message", "sym-message"] as const)(
    "does not commit a completed invalid %s capture",
    (artifactType) => {
      const originals = invalidMessageFrames(artifactType)
      let capture: RelayCapture = EMPTY_RELAY_CAPTURE
      for (const original of originals.slice(0, -1)) {
        const accepted = acceptRelayCapture(original, capture)
        expect(accepted.ok).toBe(true)
        if (!accepted.ok) return
        capture = accepted.capture
      }
      expect(acceptRelayCapture(originals.at(-1)!, capture)).toEqual({
        ok: false,
        code: "invalid-frame",
      })
    },
  )
})
