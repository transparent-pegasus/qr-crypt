import { describe, expect, it } from "vitest"
import { buildAad } from "@/crypto/envelope"
import { toBase64Url } from "@/lib/base64url"
import { decodePayload, encodeEnvelopeToPayload } from "@/qr/payload"
import {
  acceptRelayCapture,
  EMPTY_RELAY_CAPTURE,
  parseRelayMessage,
} from "@/qr/relay-frames"
import { Encoder } from "cbor-x"
import { encodePublicIdentityBundleV2 } from "@/crypto/pq/canonical-cbor"
import { FRAME_BYTES_MAX, PROTOCOL_MAX_FRAMES } from "@/lib/limits"
import { relayMessageEcLevel } from "@/qr/encode"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import {
  parseRelayFrameSet,
  parseRelayText,
  RELAY_TEXT_MAX_CHARS,
} from "@/qr/relay-frames"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import {
  OCK1_SYMMETRIC_KEY,
  OCM1_MESSAGE_33,
  OCM1_MESSAGE_44,
} from "../fixtures/relay-v1"

const TRANSFER_ID = new Uint8Array(16).fill(0x11)

function frame(frameIndex: number, overrides: Partial<QrFrameV2> = {}): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: Uint8Array.from(TRANSFER_ID),
    artifactType: "pq-message",
    frameIndex,
    frameCount: 2,
    totalByteLength: 2,
    chunk: new Uint8Array([frameIndex + 1]),
    ...overrides,
  }
}

function payload(frameIndex: number, overrides: Partial<QrFrameV2> = {}): string {
  return encodeFrameToPayload(frame(frameIndex, overrides))
}

describe("relay frame-set parser", () => {
  it("matches shared transfer metadata by bytes and every scalar field", async () => {
    type FrameMatcher = (
      metadata: {
        transferId: Uint8Array
        artifactType: V2ArtifactType
        frameCount: number
        totalByteLength: number
      },
      candidate: QrFrameV2,
    ) => boolean
    const transferState = (await import(
      "@/qr/multipart/transfer-state"
    )) as unknown as Record<string, unknown>
    const frameMatchesMetadata = transferState["frameMatchesMetadata"] as
      | FrameMatcher
      | undefined

    expect(frameMatchesMetadata).toBeTypeOf("function")
    if (frameMatchesMetadata === undefined) return

    const metadata = {
      transferId: Uint8Array.from(TRANSFER_ID),
      artifactType: "pq-message" as const,
      frameCount: 2,
      totalByteLength: 2,
    }
    expect(frameMatchesMetadata(metadata, frame(0))).toBe(true)
    expect(
      frameMatchesMetadata(metadata, frame(0, { transferId: new Uint8Array(16) })),
    ).toBe(false)
    expect(
      frameMatchesMetadata(metadata, frame(0, { artifactType: "pq-public-identity" })),
    ).toBe(false)
    expect(frameMatchesMetadata(metadata, frame(0, { frameCount: 3 }))).toBe(false)
    expect(
      frameMatchesMetadata(metadata, frame(0, { totalByteLength: 3 })),
    ).toBe(false)
  })

  it("joins out-of-order frames in index order and treats exact duplicates idempotently", () => {
    const first = payload(0)
    const second = payload(1)
    const parsed = parseRelayFrameSet([second, first, second])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.set.entries.keys()].sort()).toEqual([0, 1])

    const text = `${second}\r\n${first}\r\n`
    const roundTrip = parseRelayText(text)
    expect(roundTrip).toMatchObject({ ok: true, kind: "frames" })
    if (!roundTrip.ok || roundTrip.kind !== "frames") return
    expect(roundTrip.originals).toEqual([first, second])
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual([first, second])
  })

  it.each([
    ["OCP2:", "OCP2:AA"],
    ["OCS2:", "OCS2:AA"],
    ["OCI2:", "OCI2:AA"],
    ["OCM2:", "OCM2:AA"],
    ["v1", "OCM1:AA"],
    ["foreign", "https://example.invalid/"],
  ])("rejects the non-OCF2 %s prefix without changing state", (_label, input) => {
    const initial = parseRelayFrameSet([payload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    expect(parseRelayFrameSet([input], initial.set)).toEqual({
      ok: false,
      code: "prefix",
    })
    expect(initial.set.entries.size).toBe(1)
  })

  it.each([
    "pq-kem-public-key",
    "pq-dsa-public-key",
    "pq-public-identity",
    "encrypted-seed-backup",
  ] satisfies V2ArtifactType[])("rejects outer artifact type %s", (artifactType) => {
    expect(parseRelayFrameSet([payload(0, { artifactType })])).toEqual({
      ok: false,
      code: "outer-type",
    })
  })

  it.each([
    [
      "transferId",
      {
        transferId: new Uint8Array(16).fill(0x33),
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "artifactType",
      {
        artifactType: "pq-public-identity",
      } satisfies Partial<QrFrameV2>,
      "outer-type",
    ],
    [
      "frameCount",
      {
        frameCount: 3,
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "totalByteLength",
      {
        totalByteLength: 3,
      } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
  ] as const)("rejects a %s metadata mismatch atomically", (_label, overrides, code) => {
    const initial = parseRelayFrameSet([payload(0)])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const before = initial.set
    const result = parseRelayFrameSet([payload(1), payload(1, overrides)], before)
    expect(result).toEqual({ ok: false, code })
    expect(before.entries.size).toBe(1)
    expect(before.receivedByteLength).toBe(1)
  })

  it("rejects a conflicting occupied index without overwriting it", () => {
    const original = payload(0)
    const initial = parseRelayFrameSet([original])
    expect(initial.ok).toBe(true)
    if (!initial.ok) return
    const conflict = payload(0, { chunk: new Uint8Array([0x7f]) })
    expect(parseRelayFrameSet([conflict], initial.set)).toEqual({
      ok: false,
      code: "mismatch",
    })
    expect(initial.set.entries.get(0)?.original).toBe(original)
  })

  it.each([
    [
      "declared total above frame capacity",
      [payload(0, { totalByteLength: FRAME_BYTES_MAX * 2 + 1 })],
    ],
    [
      "single-frame chunk/total mismatch",
      [
        payload(0, {
          frameCount: 1,
          frameIndex: 0,
          totalByteLength: 2,
          chunk: new Uint8Array([1]),
        }),
      ],
    ],
    [
      "running sum above a too-small total",
      [payload(0, { totalByteLength: 1 }), payload(1, { totalByteLength: 1 })],
    ],
    [
      "completed sum below a declared total",
      [payload(0, { totalByteLength: 3 }), payload(1, { totalByteLength: 3 })],
    ],
  ])("rejects %s", (_label, inputs) => {
    expect(parseRelayFrameSet(inputs)).toEqual({
      ok: false,
      code: "length",
    })
  })

  it("rejects 129 non-empty lines and oversized raw text before decoding", () => {
    const valid = payload(0)
    expect(
      parseRelayText(
        Array.from({ length: PROTOCOL_MAX_FRAMES + 1 }, () => valid).join("\n"),
      ),
    ).toEqual({
      ok: false,
      code: "frame-count",
    })
    expect(parseRelayText("x".repeat(RELAY_TEXT_MAX_CHARS + 1))).toEqual({
      ok: false,
      code: "input-size",
    })
    expect(PROTOCOL_MAX_FRAMES).toBe(128)
    expect(RELAY_TEXT_MAX_CHARS).toBe(213_120)
  })

  it("accepts header-declared message frames around a public artifact but the offline assembler rejects the inner type", async () => {
    const keyId = "AAECAwQFBgcICQoLDA0ODw"
    const publicArtifact = encodePublicIdentityBundleV2({
      version: 2,
      type: "pq-public-identity",
      identityId: keyId,
      kem: {
        algorithm: "ML-KEM-1024",
        keyId,
        publicKey: new Uint8Array(1_568).fill(0x51),
      },
      signing: {
        algorithm: "ML-DSA-87",
        keyId,
        publicKey: new Uint8Array(2_592).fill(0x52),
      },
      createdAt: 1_700_000_000_000,
    })
    const relabeledFrames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: publicArtifact,
      frameBytes: 200,
    })
    const originals = relabeledFrames.map(encodeFrameToPayload)
    expect(parseRelayFrameSet(originals).ok).toBe(true)
    const roundTrip = parseRelayText(originals.join("\n"))
    expect(roundTrip).toMatchObject({ ok: true, kind: "frames" })
    if (!roundTrip.ok || roundTrip.kind !== "frames") return
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual(originals)
    expect(roundTrip.originals).toEqual(originals)

    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    let state = assembler.state()
    for (const original of originals) state = await assembler.add(original)
    expect(state).toEqual({ kind: "error", code: "INVALID_QR_PAYLOAD" })
  })
})

const V1_KEY_ID = "AAECAwQFBgcICQoLDA0ODw"
const V1_CREATED_AT = 1_700_000_000_000

function messageEnvelope(plaintextBytes = 32) {
  return {
    v: 1,
    type: "message",
    algorithm: "A256GCM",
    keyId: V1_KEY_ID,
    createdAt: V1_CREATED_AT,
    iv: new Uint8Array(12).fill(0x22),
    ciphertext: new Uint8Array(plaintextBytes + 16).fill(0x33),
    aad: buildAad({
      v: 1,
      type: "message",
      algorithm: "A256GCM",
      keyId: V1_KEY_ID,
      createdAt: V1_CREATED_AT,
    }),
  } as const
}

function messagePayload(plaintextBytes = 32): string {
  return encodeEnvelopeToPayload(messageEnvelope(plaintextBytes))
}

// Production-generated and parser-pinned in this node environment.
function symmetricKeyPayload(): string {
  return OCK1_SYMMETRIC_KEY
}

const relayEncoder = new Encoder({ useRecords: false, tagUint8Array: false })

// Same fields, different CBOR map key order. decodePayload accepts it because
// qr-protocol.md §2 assigns no meaning to field order; the relay must still
// refuse it, because encodeEnvelopeToPayload canonicalises through
// orderedEnvelope and the re-encode no longer equals the input.
function nonCanonicalMessagePayload(): string {
  const envelope = messageEnvelope()
  const permuted = {
    aad: envelope.aad,
    ciphertext: envelope.ciphertext,
    iv: envelope.iv,
    createdAt: envelope.createdAt,
    keyId: envelope.keyId,
    algorithm: envelope.algorithm,
    type: envelope.type,
    v: envelope.v,
  }
  return `OCM1:${toBase64Url(relayEncoder.encode(permuted))}`
}

describe("relay message acceptance", () => {
  it("pins the production-generated relay fixtures shared with UI and e2e", () => {
    expect([
      OCM1_MESSAGE_33.length,
      OCM1_MESSAGE_44.length,
      OCK1_SYMMETRIC_KEY.length,
    ]).toEqual([311, 311, 177])
    for (const original of [OCM1_MESSAGE_33, OCM1_MESSAGE_44]) {
      expect(parseRelayMessage(original)).toEqual({
        ok: true,
        payload: original,
      })
    }
    expect(decodePayload(OCK1_SYMMETRIC_KEY).kind).toBe("symmetric-key")
    expect(parseRelayMessage(OCK1_SYMMETRIC_KEY)).toEqual({
      ok: false,
      code: "prefix",
    })
  })

  it("accepts a canonical OCM1 payload and returns it verbatim", () => {
    const original = messagePayload()
    expect(parseRelayMessage(original)).toEqual({ ok: true, payload: original })
  })

  it("refuses a semantically valid but non-canonical CBOR ordering", () => {
    const permuted = nonCanonicalMessagePayload()
    // Prove the fixture really is a decodable message, so the rejection below
    // can only come from the exact re-encode check.
    expect(decodePayload(permuted).kind).toBe("message")
    expect(permuted).not.toBe(messagePayload())
    expect(parseRelayMessage(permuted)).toEqual({
      ok: false,
      code: "invalid-message",
    })
  })

  it("refuses a trailing CBOR item after a valid envelope", () => {
    const bytes = relayEncoder.encode(messageEnvelope())
    const trailing = relayEncoder.encode(1)
    const joined = new Uint8Array(bytes.byteLength + trailing.byteLength)
    joined.set(bytes, 0)
    joined.set(trailing, bytes.byteLength)
    // Rejected by decodeMultiple's single-item enforcement, not by the
    // round-trip check — a different guard, worth pinning separately.
    expect(parseRelayMessage(`OCM1:${toBase64Url(joined)}`)).toEqual({
      ok: false,
      code: "invalid-message",
    })
  })
})

describe("relay acceptance boundary", () => {
  const forbidden = () => [
    ["canonical OCK1 symmetric key", symmetricKeyPayload()],
    ["OCP1 public key", "OCP1:AA"],
    ["OCB1 reserved backup", "OCB1:AA"],
    ["OCM2 pq message", "OCM2:AA"],
    ["OCP2 kem public key", "OCP2:AA"],
    ["OCS2 dsa public key", "OCS2:AA"],
    ["OCI2 public identity", "OCI2:AA"],
    ["OCB2 seed backup", "OCB2:AA"],
    ["foreign", "https://example.invalid/"],
  ]

  it.each(forbidden())(
    "refuses %s at the capture boundary from an idle session",
    (_label, input) => {
      expect(acceptRelayCapture(input, EMPTY_RELAY_CAPTURE)).toEqual({
        ok: false,
        code: "prefix",
      })
    },
  )

  it.each(forbidden())(
    "refuses %s at the capture boundary during a message session",
    (_label, input) => {
      const started = acceptRelayCapture(messagePayload(), EMPTY_RELAY_CAPTURE)
      expect(started).toMatchObject({ ok: true })
      if (!started.ok) return
      // A forbidden prefix is a prefix error, never a kind mismatch: a kind
      // mismatch means "this is the other allowed kind", which these are not.
      expect(acceptRelayCapture(input, started.capture)).toEqual({
        ok: false,
        code: "prefix",
      })
      expect(started.capture).toMatchObject({ kind: "message" })
    },
  )

  it.each(forbidden())(
    "refuses %s at the capture boundary during a frame session",
    (_label, input) => {
      const started = acceptRelayCapture(payload(0), EMPTY_RELAY_CAPTURE)
      expect(started).toMatchObject({ ok: true })
      if (!started.ok) return
      expect(acceptRelayCapture(input, started.capture)).toEqual({
        ok: false,
        code: "prefix",
      })
      expect(started.capture).toMatchObject({ kind: "frames" })
    },
  )

  it.each(forbidden())(
    "refuses %s at the playback boundary",
    (_label, input) => {
      expect(parseRelayText(input)).toEqual({ ok: false, code: "prefix" })
    },
  )

  it("refuses an OCF2 frame whose outer header is not pq-message, at both boundaries", () => {
    const relabeled = payload(0, { artifactType: "pq-public-identity" })
    expect(acceptRelayCapture(relabeled, EMPTY_RELAY_CAPTURE)).toEqual({
      ok: false,
      code: "outer-type",
    })
    expect(parseRelayText(relabeled)).toEqual({ ok: false, code: "outer-type" })
  })
})

describe("relay capture session kind", () => {
  it("fixes the kind on the first accepted payload and refuses the other kind", () => {
    const message = messagePayload()
    expect(EMPTY_RELAY_CAPTURE.kind).toBeNull()

    const accepted = acceptRelayCapture(message, EMPTY_RELAY_CAPTURE)
    expect(accepted).toMatchObject({ ok: true })
    if (!accepted.ok || accepted.capture.kind !== "message") return
    expect(accepted.capture.payload).toBe(message)

    expect(acceptRelayCapture(payload(0), accepted.capture)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
    expect(accepted.capture.payload).toBe(message)
  })

  it("refuses an OCM1 once frames have been accepted", () => {
    const frames = acceptRelayCapture(payload(0), EMPTY_RELAY_CAPTURE)
    expect(frames).toMatchObject({ ok: true })
    if (!frames.ok || frames.capture.kind !== "frames") return
    expect(acceptRelayCapture(messagePayload(), frames.capture)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
    expect(frames.capture.set.entries.size).toBe(1)
  })

  it("validates an other-kind candidate before reporting a session mismatch", () => {
    const frames = acceptRelayCapture(payload(0), EMPTY_RELAY_CAPTURE)
    expect(frames).toMatchObject({ ok: true })
    if (!frames.ok) return
    expect(acceptRelayCapture("OCM1:AA", frames.capture)).toEqual({
      ok: false,
      code: "invalid-message",
    })

    const message = acceptRelayCapture(messagePayload(), EMPTY_RELAY_CAPTURE)
    expect(message).toMatchObject({ ok: true })
    if (!message.ok) return
    expect(acceptRelayCapture("OCF2:AA", message.capture)).toEqual({
      ok: false,
      code: "invalid-frame",
    })
    expect(
      acceptRelayCapture(
        payload(0, { artifactType: "pq-public-identity" }),
        message.capture,
      ),
    ).toEqual({
      ok: false,
      code: "outer-type",
    })
  })

  it("re-accepts the identical OCM1 idempotently but refuses a different one", () => {
    const message = messagePayload()
    const first = acceptRelayCapture(message, EMPTY_RELAY_CAPTURE)
    expect(first).toMatchObject({ ok: true })
    if (!first.ok) return

    const again = acceptRelayCapture(message, first.capture)
    expect(again).toMatchObject({ ok: true })
    if (!again.ok || again.capture.kind !== "message") return
    expect(again.capture.payload).toBe(message)

    const other = messagePayload(64)
    expect(other).not.toBe(message)
    expect(acceptRelayCapture(other, first.capture)).toEqual({
      ok: false,
      code: "mismatch",
    })
  })

  it("parses a single OCM1 line and refuses a mixed or repeated set", () => {
    const message = messagePayload()
    expect(parseRelayText(message)).toEqual({
      ok: true,
      kind: "message",
      payload: message,
    })
    expect(parseRelayText(`${message}\r\n`)).toEqual({
      ok: true,
      kind: "message",
      payload: message,
    })
    expect(parseRelayText(`${message}\n${payload(0)}`)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
    expect(parseRelayText(`${message}\n${message}`)).toEqual({
      ok: false,
      code: "message-count",
    })
  })

  it("reports message-count before decoding a malformed second OCM1 line", () => {
    expect(parseRelayText(`${messagePayload()}\nOCM1:AA`)).toEqual({
      ok: false,
      code: "message-count",
    })
  })

  it("reports message-count before decoding a malformed first OCM1 line", () => {
    expect(parseRelayText(`OCM1:AA\n${messagePayload()}`)).toEqual({
      ok: false,
      code: "message-count",
    })
  })

  it("reports kind-mismatch from prefixes before decoding a malformed OCF2 line", () => {
    expect(parseRelayText(`${messagePayload()}\nOCF2:AA`)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
  })

  it("reports frame-count before decoding an over-limit frame set", () => {
    const lines = Array.from(
      { length: PROTOCOL_MAX_FRAMES + 1 },
      (_, index) => (index === PROTOCOL_MAX_FRAMES ? "OCF2:AA" : payload(0)),
    )
    expect(parseRelayText(lines.join("\n"))).toEqual({
      ok: false,
      code: "frame-count",
    })
  })

  it("reports message-count for a large OCM1-prefixed paste without decoding it", () => {
    const lines = Array.from(
      { length: PROTOCOL_MAX_FRAMES },
      () => "OCM1:AA",
    )
    expect(parseRelayText(lines.join("\n"))).toEqual({
      ok: false,
      code: "message-count",
    })
  })

  it("gives unknown prefixes precedence and decides allowed-prefix kind conflicts before decoding", () => {
    const message = messagePayload()
    expect(
      parseRelayText(`OCM1:AA\nhttps://example.invalid/`),
    ).toEqual({
      ok: false,
      code: "prefix",
    })
    expect(parseRelayText(`${message}\nOCF2:AA`)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
    expect(parseRelayText(`OCM1:AA\n${payload(0)}`)).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
    expect(
      parseRelayText(
        `${message}\n${payload(0, { artifactType: "pq-public-identity" })}`,
      ),
    ).toEqual({
      ok: false,
      code: "kind-mismatch",
    })
  })
})

describe("relay playback error-correction ladder", () => {
  // Pure length classification against QR_BYTE_CAPACITY; it does not encode a QR.
  it.each([
    [1, "Q"],
    [1_663, "Q"],
    [1_664, "M"],
    [2_331, "M"],
    [2_332, "L"],
    [2_953, "L"],
  ] as const)("classifies a %i-character payload as %s", (length, ecLevel) => {
    expect(relayMessageEcLevel("A".repeat(length))).toBe(ecLevel)
  })
})
