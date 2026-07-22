import { describe, expect, it } from "vitest"
import type { QrFrameV2 } from "@/schemas/domain"
import { encodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"
import { sha256 } from "@/lib/bytes"
import { payloadFits } from "@/qr/encode"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload } from "@/qr/payload-v2"

function pseudoArtifact(payloadBytes: number, type = "pq-message"): Uint8Array {
  return encodeCanonicalCbor({
    type,
    payload: new Uint8Array(payloadBytes).fill(0xa5),
  })
}

function framePayloads(frames: readonly QrFrameV2[]): string[] {
  return frames.map((frame) => encodeFrameToPayload(frame))
}

async function addFrames(
  assembler: TransferAssembler,
  frames: readonly QrFrameV2[],
): Promise<ReturnType<TransferAssembler["state"]>> {
  let state = assembler.state()
  for (const payload of framePayloads(frames)) state = await assembler.add(payload)
  return state
}

function expectCompleteBytes(
  state: ReturnType<TransferAssembler["state"]>,
  expected: Uint8Array,
): void {
  expect(state.kind).toBe("complete")
  if (state.kind !== "complete") throw new Error("transfer did not complete")
  expect(state.artifactBytes).toEqual(expected)
  expect(state.artifactType).toBe("pq-message")
}

describe("splitIntoFrames", () => {
  it("creates a one-frame transfer from raw artifact bytes", async () => {
    const artifactBytes = pseudoArtifact(100)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })

    expect(frames).toHaveLength(1)
    expect(frames[0]).toMatchObject({
      version: 2,
      type: "qr-frame",
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: artifactBytes.byteLength,
      artifactType: "pq-message",
    })
    expect(frames[0]!.transferId).toHaveLength(16)
    expect(frames[0]!.payloadSha256).toEqual(await sha256(artifactBytes))
    expect(frames[0]!.chunk).toEqual(artifactBytes)
  })

  it("splits directly at the configured raw-byte boundary", async () => {
    const artifactBytes = pseudoArtifact(500)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })

    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.chunk.byteLength)).toEqual([
      400,
      artifactBytes.byteLength - 400,
    ])
    const joined = new Uint8Array(artifactBytes.byteLength)
    joined.set(frames[0]!.chunk)
    joined.set(frames[1]!.chunk, frames[0]!.chunk.byteLength)
    expect(joined).toEqual(artifactBytes)
  })

  it("generates exactly 64 frames at the protocol limit", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(25_550),
      frameBytes: 400,
    })
    expect(frames).toHaveLength(64)
    expect(frames.at(-1)?.frameIndex).toBe(63)
  })

  it.each([400, 600, 900])(
    "round-trips and fits every EC-Q payload with frameBytes=%i",
    async (frameBytes) => {
      const artifactBytes = pseudoArtifact(1_700)
      const frames = await splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes,
      })
      expect(framePayloads(frames).every((payload) => payloadFits(payload, "Q"))).toBe(
        true,
      )

      const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
      expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
    },
  )

  it("rejects transfers over env.qrMaxFrames", async () => {
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: pseudoArtifact(25_601),
        frameBytes: 400,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })

  it("rejects generation of the reserved seed-backup artifact", async () => {
    await expect(
      splitIntoFrames({
        artifactType: "encrypted-seed-backup",
        artifactBytes: pseudoArtifact(10, "encrypted-seed-backup"),
        frameBytes: 400,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
  })
})

describe("TransferAssembler", () => {
  it.each([
    ["one", 100, 1],
    ["two", 500, 2],
    ["sixty-four", 25_550, 64],
  ] as const)("assembles a %s-frame-class transfer", async (_name, size, count) => {
    const artifactBytes = pseudoArtifact(size)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    expect(frames).toHaveLength(count)
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("assembles frames in arbitrary order", async () => {
    const artifactBytes = pseudoArtifact(1_500)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    const reordered = [frames[2]!, frames[0]!, frames[3]!, frames[1]!]
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expectCompleteBytes(await addFrames(assembler, reordered), artifactBytes)
  })

  it("ignores a byte-identical duplicate", async () => {
    const artifactBytes = pseudoArtifact(500)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    const duplicateState = await assembler.add(encodeFrameToPayload(frames[0]!))
    expect(duplicateState.kind).toBe("collecting")
    if (duplicateState.kind !== "collecting") throw new Error("unexpected state")
    expect([...duplicateState.receivedIndexes]).toEqual([0])
    expectCompleteBytes(
      await assembler.add(encodeFrameToPayload(frames[1]!)),
      artifactBytes,
    )
  })

  it("poisons the session on a differing duplicate", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    const changedChunk = Uint8Array.from(frames[0]!.chunk)
    changedChunk[0] = changedChunk[0]! ^ 1
    const changedFrame = { ...frames[0]!, chunk: changedChunk }
    expect(await assembler.add(encodeFrameToPayload(changedFrame))).toEqual({
      kind: "error",
      code: "FRAME_MISMATCH",
    })
  })

  it("reports every missing frame index", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(1_500),
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    await assembler.add(encodeFrameToPayload(frames[2]!))
    const state = await assembler.add(encodeFrameToPayload(frames[0]!))
    expect(state.kind).toBe("collecting")
    if (state.kind !== "collecting") throw new Error("unexpected state")
    expect([...state.receivedIndexes]).toEqual([0, 2])
    expect(state.missingIndexes).toEqual([1, 3])
  })

  it("rejects a different transferId and frees the poisoned session", async () => {
    const first = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const second = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(600),
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    await assembler.add(encodeFrameToPayload(first[0]!))
    expect(await assembler.add(encodeFrameToPayload(second[0]!))).toEqual({
      kind: "error",
      code: "FRAME_MISMATCH",
    })

    assembler.discard()
    expect(assembler.state()).toEqual({ kind: "idle" })
    expectCompleteBytes(await addFrames(assembler, second), pseudoArtifact(600))
  })

  it("detects a changed unique chunk through the final SHA-256", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const changedChunk = Uint8Array.from(frames[1]!.chunk)
    changedChunk[0] = changedChunk[0]! ^ 1
    const changedFrames = [frames[0]!, { ...frames[1]!, chunk: changedChunk }]
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expect(await addFrames(assembler, changedFrames)).toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
  })

  it("detects a consistently wrong whole-payload hash", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const wrongHash = new Uint8Array(32).fill(0xff)
    const changedFrames = frames.map((frame) => ({
      ...frame,
      payloadSha256: Uint8Array.from(wrongHash),
    }))
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expect(await addFrames(assembler, changedFrames)).toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
  })

  it("keeps collection state across a camera-restart-sized pause", async () => {
    const artifactBytes = pseudoArtifact(900)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    expect(assembler.state()).toMatchObject({ kind: "collecting" })
    expectCompleteBytes(await addFrames(assembler, frames.slice(1)), artifactBytes)
  })

  it("drops collected chunks at the timeout and can start again", async () => {
    let now = 1_000
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: 1,
      now: () => now,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    now = 60_999
    expect(assembler.state().kind).toBe("collecting")
    now = 61_000
    expect(assembler.state()).toEqual({ kind: "idle" })
    const restarted = await assembler.add(encodeFrameToPayload(frames[1]!))
    expect(restarted.kind).toBe("collecting")
    if (restarted.kind !== "collecting") throw new Error("unexpected state")
    expect([...restarted.receivedIndexes]).toEqual([1])
  })

  it("drops the frame that first observes an expired transfer", async () => {
    let now = 0
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: 1,
      now: () => now,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    now = 60_001
    expect(await assembler.add(encodeFrameToPayload(frames[1]!))).toEqual({
      kind: "idle",
    })
    expect((await assembler.add(encodeFrameToPayload(frames[1]!))).kind).toBe(
      "collecting",
    )
  })

  it("handles a signed 30-Japanese-character-sized pseudo artifact", async () => {
    const artifactBytes = encodeCanonicalCbor({
      type: "pq-message",
      label: "暗".repeat(30),
      payload: new Uint8Array(4_800).fill(0x65),
    })
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 600,
    })
    expect(frames).toHaveLength(9)
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("handles an 8.9KB artifact representing a 4096-byte plaintext", async () => {
    const artifactBytes = pseudoArtifact(8_850)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 600,
    })
    expect(frames).toHaveLength(15)
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("rejects an artifact whose restored type differs from frame metadata", async () => {
    const artifactBytes = pseudoArtifact(100, "pq-public-identity")
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expect(await addFrames(assembler, frames)).toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
  })

  it("rejects a restored encrypted-seed-backup type", async () => {
    const artifactBytes = pseudoArtifact(100, "encrypted-seed-backup")
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: 400,
    })
    const assembler = new TransferAssembler({ transferTimeoutMinutes: 10 })
    expect(await addFrames(assembler, frames)).toEqual({
      kind: "error",
      code: "UNSUPPORTED_ALGORITHM",
    })
  })
})
