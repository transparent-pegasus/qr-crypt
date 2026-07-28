import { describe, expect, it } from "vitest"
import { encodePublicIdentityBundleV2 } from "@/crypto/pq/canonical-cbor"
import { FRAME_BYTES_MAX, PROTOCOL_MAX_FRAMES } from "@/lib/limits"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"
import {
  parseRelayFrameSet,
  parseRelayText,
  RELAY_TEXT_MAX_CHARS,
} from "@/qr/relay-frames"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"

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
  it("joins out-of-order frames in index order and treats exact duplicates idempotently", () => {
    const first = payload(0)
    const second = payload(1)
    const parsed = parseRelayFrameSet([second, first, second])
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect([...parsed.set.entries.keys()].sort()).toEqual([0, 1])

    const text = `${second}\r\n${first}\r\n`
    const roundTrip = parseRelayText(text)
    expect(roundTrip).toMatchObject({ ok: true })
    if (!roundTrip.ok) return
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
    expect(roundTrip.ok).toBe(true)
    if (!roundTrip.ok) return
    expect(roundTrip.frames.map(encodeFrameToPayload)).toEqual(originals)
    expect(roundTrip.originals).toEqual(originals)

    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    let state = assembler.state()
    for (const original of originals) state = await assembler.add(original)
    expect(state).toEqual({ kind: "error", code: "INVALID_QR_PAYLOAD" })
  })
})
