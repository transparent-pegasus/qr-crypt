import { describe, expect, it } from "vitest"
import { encodePublicIdentityBundleV2 } from "@/crypto/pq/canonical-cbor"
import { FRAME_BYTES_MAX, PROTOCOL_MAX_FRAMES } from "@/lib/limits"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import {
  acceptRelayCapture,
  EMPTY_RELAY_CAPTURE,
  parseRelayFrameSet,
  parseRelayText,
  RELAY_TEXT_MAX_CHARS,
} from "@/qr/relay-frames"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import {
  OCK1_SYMMETRIC_KEY,
  OCM1_MESSAGE_33,
  OCP1_PUBLIC_KEY,
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
    const transferState =
      (await import("@/qr/multipart/transfer-state")) as unknown as Record<
        string,
        unknown
      >
    const frameMatchesMetadata = transferState["frameMatchesMetadata"] as
      FrameMatcher | undefined

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
      frameMatchesMetadata(metadata, frame(0, { artifactType: "sym-message" })),
    ).toBe(false)
    expect(frameMatchesMetadata(metadata, frame(0, { frameCount: 3 }))).toBe(false)
    expect(frameMatchesMetadata(metadata, frame(0, { totalByteLength: 3 }))).toBe(false)
  })

  it("joins out-of-order frames in index order and treats exact duplicates idempotently", () => {
    const first = payload(0)
    const second = payload(1)
    const parsed = parseRelayFrameSet([second, first, second])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.set.entries.keys()].sort()).toEqual([0, 1])

    const roundTrip = parseRelayText(`${second}\r\n${first}\r\n`)
    expect(roundTrip).toMatchObject({ ok: true, kind: "frames" })
    if (!roundTrip.ok) return
    expect(roundTrip.originals).toEqual([first, second])
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual([first, second])
  })

  it.each([
    ["bare sym-message", "OCA2:AA"],
    ["bare symmetric key", "OCK2:AA"],
    ["bare KEM public key", "OCP2:AA"],
    ["bare DSA public key", "OCS2:AA"],
    ["bare identity", "OCI2:AA"],
    ["retired OCM1", OCM1_MESSAGE_33],
    ["retired OCK1", OCK1_SYMMETRIC_KEY],
    ["retired OCP1", OCP1_PUBLIC_KEY],
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

  it.each(["pq-message", "sym-message"] as const)(
    "accepts the message outer artifact type %s",
    (artifactType) => {
      expect(parseRelayFrameSet([payload(0, { artifactType })])).toMatchObject({
        ok: true,
      })
    },
  )

  it.each([
    "pq-kem-public-key",
    "pq-dsa-public-key",
    "pq-public-identity",
    "symmetric-key",
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
      { transferId: new Uint8Array(16).fill(0x33) } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    [
      "artifactType",
      { artifactType: "sym-message" } satisfies Partial<QrFrameV2>,
      "mismatch",
    ],
    ["frameCount", { frameCount: 3 } satisfies Partial<QrFrameV2>, "mismatch"],
    ["totalByteLength", { totalByteLength: 3 } satisfies Partial<QrFrameV2>, "mismatch"],
  ] as const)("rejects a metadata mismatch in %s atomically", (_label, overrides, code) => {
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

  it("lets the offline assembler reject a public artifact relabeled as a message", async () => {
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

    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    let state = assembler.state()
    for (const original of originals) state = await assembler.add(original)
    expect(state).toEqual({ kind: "error", code: "INVALID_QR_PAYLOAD" })
  })
})

const FORBIDDEN_NON_FRAME_PAYLOADS = [
  ["previously valid OCM1 message", OCM1_MESSAGE_33],
  ["previously valid OCK1 symmetric key", OCK1_SYMMETRIC_KEY],
  ["previously valid OCP1 public key", OCP1_PUBLIC_KEY],
  ["bare OCA2 sym-message", "OCA2:AA"],
  ["bare OCK2 symmetric key", "OCK2:AA"],
  ["bare OCM2 pq message", "OCM2:AA"],
  ["foreign input", "https://example.invalid/"],
] as const

describe("frame-only relay boundary", () => {
  it.each(FORBIDDEN_NON_FRAME_PAYLOADS)(
    "refuses %s from an idle capture",
    (_label, input) => {
      expect(acceptRelayCapture(input, EMPTY_RELAY_CAPTURE)).toEqual({
        ok: false,
        code: "prefix",
      })
    },
  )

  it.each(FORBIDDEN_NON_FRAME_PAYLOADS)(
    "refuses %s during a frame capture without discarding accepted frames",
    (_label, input) => {
      const started = acceptRelayCapture(payload(0), EMPTY_RELAY_CAPTURE)
      expect(started).toMatchObject({ ok: true })
      if (!started.ok || started.capture.kind !== "frames") return

      expect(acceptRelayCapture(input, started.capture)).toEqual({
        ok: false,
        code: "prefix",
      })
      expect(started.capture.set.entries.size).toBe(1)
    },
  )

  it.each(FORBIDDEN_NON_FRAME_PAYLOADS)(
    "refuses %s at text playback",
    (_label, input) => {
      expect(parseRelayText(input)).toEqual({ ok: false, code: "prefix" })
    },
  )

  it("captures only frames and accepts exact duplicates idempotently", () => {
    const firstPayload = payload(0)
    const first = acceptRelayCapture(firstPayload, EMPTY_RELAY_CAPTURE)
    expect(first).toMatchObject({ ok: true, capture: { kind: "frames" } })
    if (!first.ok || first.capture.kind !== "frames") return

    const duplicate = acceptRelayCapture(firstPayload, first.capture)
    expect(duplicate).toMatchObject({ ok: true, capture: { kind: "frames" } })
    if (!duplicate.ok || duplicate.capture.kind !== "frames") return
    expect(duplicate.capture.set.entries.size).toBe(1)

    const complete = acceptRelayCapture(payload(1), duplicate.capture)
    expect(complete).toMatchObject({ ok: true, capture: { kind: "frames" } })
  })

  it("rejects a non-message outer header at camera and playback boundaries", () => {
    const relabeled = payload(0, { artifactType: "pq-public-identity" })
    expect(acceptRelayCapture(relabeled, EMPTY_RELAY_CAPTURE)).toEqual({
      ok: false,
      code: "outer-type",
    })
    expect(parseRelayText(relabeled)).toEqual({ ok: false, code: "outer-type" })
  })

  it("gives a retired prefix precedence over frame parsing and cardinality", () => {
    expect(parseRelayText(`${OCM1_MESSAGE_33}\n${payload(0)}`)).toEqual({
      ok: false,
      code: "prefix",
    })
    expect(parseRelayText(`${OCM1_MESSAGE_33}\n${OCM1_MESSAGE_33}`)).toEqual({
      ok: false,
      code: "prefix",
    })
  })
})
