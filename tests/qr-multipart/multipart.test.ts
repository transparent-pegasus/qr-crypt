import { describe, expect, it, vi } from "vitest"
import type { QrFrameV2 } from "@/schemas/domain"
import { encodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"
import { toBase64Url } from "@/lib/base64url"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_MIN,
  FRAME_BYTES_VALUES,
  FRAME_CHUNK_MAX_BYTES,
  FRAME_INTERVAL_MS_MAX,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  PROTOCOL_MAX_FRAMES,
  TRANSFER_TIMEOUT_MINUTES_DEFAULT,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import { payloadFits } from "@/qr/encode"
import { TransferAssembler } from "@/qr/multipart/assemble"
import { splitIntoFrames } from "@/qr/multipart/split"
import { encodeFrameToPayload, QR_PREFIX_V2 } from "@/qr/payload-v2"

function pseudoArtifact(payloadBytes: number, type = "pq-message"): Uint8Array {
  return encodeCanonicalCbor({
    type,
    payload: new Uint8Array(payloadBytes).fill(0xa5),
  })
}

function pseudoArtifactOfTotalBytes(totalByteLength: number): Uint8Array {
  let low = 0
  let high = totalByteLength
  while (low <= high) {
    const payloadBytes = Math.floor((low + high) / 2)
    const artifactBytes = pseudoArtifact(payloadBytes)
    if (artifactBytes.byteLength === totalByteLength) return artifactBytes
    if (artifactBytes.byteLength < totalByteLength) low = payloadBytes + 1
    else high = payloadBytes - 1
  }
  throw new Error(`cannot construct pseudo artifact of ${totalByteLength} bytes`)
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
      frameBytes: FRAME_BYTES_MAX,
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
    expect(frames[0]!.chunk).toEqual(artifactBytes)
  })

  it("splits directly at the 1000/1001 raw-byte boundary", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })

    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.chunk.byteLength)).toEqual([
      FRAME_BYTES_MAX,
      artifactBytes.byteLength - FRAME_BYTES_MAX,
    ])
    const joined = new Uint8Array(artifactBytes.byteLength)
    joined.set(frames[0]!.chunk)
    joined.set(frames[1]!.chunk, frames[0]!.chunk.byteLength)
    expect(joined).toEqual(artifactBytes)
  })

  it("keeps the 100B fallback generatable across its split boundary", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MIN + 1)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MIN,
    })

    expect(FRAME_BYTES_MIN).toBe(100)
    expect(frames).toHaveLength(2)
    expect(frames.map((frame) => frame.chunk.byteLength)).toEqual([
      FRAME_BYTES_MIN,
      1,
    ])
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    FRAME_BYTES_MIN - 1,
    FRAME_BYTES_MAX + 1,
  ])("rejects invalid frameBytes=%s", async (frameBytes) => {
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: pseudoArtifact(100),
        frameBytes,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })
})

// This generator only emits uniform chunks, but a foreign or hostile sender is
// under no such obligation and the receiver accepts any non-empty partition of
// the artifact. Retiring the balanced generation mode must not narrow that, so
// these frames are hand-built rather than produced by splitIntoFrames.
describe("TransferAssembler on partitions this generator never emits", () => {
  function handBuiltFrames(
    artifactBytes: Uint8Array,
    chunkLengths: readonly number[],
  ): QrFrameV2[] {
    const transferId = new Uint8Array(16).fill(7)
    const frames: QrFrameV2[] = []
    let offset = 0
    for (const [frameIndex, chunkLength] of chunkLengths.entries()) {
      frames.push({
        version: 2,
        type: "qr-frame",
        transferId: Uint8Array.from(transferId),
        artifactType: "pq-message",
        frameIndex,
        frameCount: chunkLengths.length,
        totalByteLength: artifactBytes.byteLength,
        chunk: artifactBytes.slice(offset, offset + chunkLength),
      })
      offset += chunkLength
    }
    expect(offset).toBe(artifactBytes.byteLength)
    return frames
  }

  it("assembles an evenly balanced partition whose chunks differ by one byte", async () => {
    const artifactBytes = pseudoArtifact(1_000)
    const frameCount = 7
    const base = Math.floor(artifactBytes.byteLength / frameCount)
    const remainder = artifactBytes.byteLength % frameCount
    const chunkLengths = Array.from(
      { length: frameCount },
      (_unused, frameIndex) => base + (frameIndex < remainder ? 1 : 0),
    )
    expect(Math.max(...chunkLengths) - Math.min(...chunkLengths)).toBeLessThanOrEqual(1)
    expect(chunkLengths.every((length) => length > 0)).toBe(true)

    const frames = handBuiltFrames(artifactBytes, chunkLengths)
    expect(framePayloads(frames).every((payload) => payloadFits(payload, "Q"))).toBe(
      true,
    )
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("assembles a partition whose final chunk is a single byte", async () => {
    // Every chunk must stay within FRAME_CHUNK_MAX_BYTES, so the leading chunk
    // bounds how large the artifact may be for a two-frame partition.
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_CHUNK_MAX_BYTES + 1)
    const frames = handBuiltFrames(artifactBytes, [FRAME_CHUNK_MAX_BYTES, 1])
    expect(frames.map((frame) => frame.chunk.byteLength).at(-1)).toBe(1)

    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("cannot even encode a chunk over the 1000-byte protocol limit", () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_CHUNK_MAX_BYTES * 2 + 1)
    const frame: QrFrameV2 = {
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16).fill(7),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 2,
      totalByteLength: artifactBytes.byteLength,
      chunk: artifactBytes.slice(0, FRAME_CHUNK_MAX_BYTES + 1),
    }
    // The frame codec is the boundary: an over-limit chunk has no valid wire
    // representation, so a receiver can never be offered one.
    expect(() => encodeFrameToPayload(frame)).toThrow(
      expect.objectContaining({ code: "INVALID_QR_PAYLOAD" }),
    )
  })
})

describe("splitIntoFrames, continued", () => {

  it("accepts the exact absolute ceiling through one slowest full cycle", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(MAX_ARTIFACT_BYTES_ABSOLUTE)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    expect(frames).toHaveLength(PROTOCOL_MAX_FRAMES)
    expect(
      frames.every((frame) => frame.chunk.byteLength === FRAME_CHUNK_MAX_BYTES),
    ).toBe(true)

    let now = 0
    const slowestFullCycleMs = PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MAX
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_MIN,
      now: () => now,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    for (const frame of frames.slice(1, -1)) {
      await assembler.add(encodeFrameToPayload(frame))
    }
    now = slowestFullCycleMs
    expectCompleteBytes(
      await assembler.add(encodeFrameToPayload(frames.at(-1)!)),
      artifactBytes,
    )
  })

  it.each(
    FRAME_BYTES_VALUES.filter((frameBytes) => frameBytes !== FRAME_BYTES_MAX),
  )(
    "round-trips and fits an EC-Q payload with non-maximum frameBytes=%i",
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

      const assembler = new TransferAssembler({
        transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
      })
      expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
    },
  )

  it("rejects one byte over the absolute ceiling before hashing at every density", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(
      MAX_ARTIFACT_BYTES_ABSOLUTE + 1,
    )
    expect(artifactBytes).toHaveLength(MAX_ARTIFACT_BYTES_ABSOLUTE + 1)
    const digest = vi.spyOn(globalThis.crypto.subtle, "digest")
    try {
      for (const frameBytes of [FRAME_BYTES_MIN, FRAME_BYTES_MAX] as const) {
        await expect(
          splitIntoFrames({
            artifactType: "pq-message",
            artifactBytes,
            frameBytes,
          }),
        ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
      }
      expect(digest).not.toHaveBeenCalled()
    } finally {
      digest.mockRestore()
    }
  })

  it("rejects generation of the reserved seed-backup artifact", async () => {
    await expect(
      splitIntoFrames({
        artifactType: "encrypted-seed-backup",
        artifactBytes: pseudoArtifact(10, "encrypted-seed-backup"),
        frameBytes: FRAME_BYTES_MAX,
      }),
    ).rejects.toMatchObject({ code: "UNSUPPORTED_ALGORITHM" })
  })
})

describe("TransferAssembler", () => {
  it.each([
    ["one", FRAME_BYTES_MAX, 1],
    ["two", FRAME_BYTES_MAX + 1, 2],
  ] as const)(
    "assembles a %s-frame-class transfer",
    async (_name, totalByteLength, count) => {
      const artifactBytes = pseudoArtifactOfTotalBytes(totalByteLength)
      const frames = await splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes: FRAME_BYTES_MAX,
      })
      expect(frames).toHaveLength(count)
      const assembler = new TransferAssembler({
        transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
      })
      expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
    },
  )

  it("rejects one-byte absolute overflow at the assembler receiver boundary", async () => {
    const hostileFrame = {
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: PROTOCOL_MAX_FRAMES,
      totalByteLength: MAX_ARTIFACT_BYTES_ABSOLUTE + 1,
      chunk: new Uint8Array(FRAME_CHUNK_MAX_BYTES),
    } as const
    const payload = `${QR_PREFIX_V2.frame}${toBase64Url(
      encodeCanonicalCbor(hostileFrame),
    )}`
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })

    await expect(assembler.add(payload)).resolves.toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
  })

  it("rejects inconsistent single-frame lengths before opening transfer state", async () => {
    const now = vi.fn(() => 0)
    const hostileFrame = {
      version: 2,
      type: "qr-frame",
      transferId: new Uint8Array(16),
      artifactType: "pq-message",
      frameIndex: 0,
      frameCount: 1,
      totalByteLength: 2,
      chunk: Uint8Array.of(1),
    } as const
    const payload = `${QR_PREFIX_V2.frame}${toBase64Url(
      encodeCanonicalCbor(hostileFrame),
    )}`
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
      now,
    })

    await expect(assembler.add(payload)).resolves.toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
    expect(now).not.toHaveBeenCalled()
  })

  it("assembles frames in arbitrary order", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX * 4)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const reordered = [frames[2]!, frames[0]!, frames[3]!, frames[1]!]
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, reordered), artifactBytes)
  })

  it("ignores a byte-identical duplicate", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
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
      artifactBytes: pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1),
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
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
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX * 4)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    await assembler.add(encodeFrameToPayload(frames[2]!))
    const state = await assembler.add(encodeFrameToPayload(frames[0]!))
    expect(state.kind).toBe("collecting")
    if (state.kind !== "collecting") throw new Error("unexpected state")
    expect([...state.receivedIndexes]).toEqual([0, 2])
    expect(state.missingIndexes).toEqual([1, 3])
  })

  it("rejects a different transferId and frees the poisoned session", async () => {
    const firstArtifact = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1)
    const secondArtifact = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 2)
    const first = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: firstArtifact,
      frameBytes: FRAME_BYTES_MAX,
    })
    const second = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: secondArtifact,
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    await assembler.add(encodeFrameToPayload(first[0]!))
    expect(await assembler.add(encodeFrameToPayload(second[0]!))).toEqual({
      kind: "error",
      code: "FRAME_MISMATCH",
    })

    assembler.discard()
    expect(assembler.state()).toEqual({ kind: "idle" })
    expectCompleteBytes(await addFrames(assembler, second), secondArtifact)
  })

  it("accepts a changed unique chunk when the artifact remains canonical", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const changedChunk = Uint8Array.from(frames[1]!.chunk)
    changedChunk[0] = changedChunk[0]! ^ 1
    const changedFrames = [frames[0]!, { ...frames[1]!, chunk: changedChunk }]
    const changedArtifactBytes = Uint8Array.from(artifactBytes)
    changedArtifactBytes[frames[0]!.chunk.byteLength] =
      changedArtifactBytes[frames[0]!.chunk.byteLength]! ^ 1
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expect(changedArtifactBytes).not.toEqual(artifactBytes)
    expectCompleteBytes(
      await addFrames(assembler, changedFrames),
      changedArtifactBytes,
    )
  })

  it("keeps collection state across a camera-restart-sized pause", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    expect(assembler.state()).toMatchObject({ kind: "collecting" })
    expectCompleteBytes(await addFrames(assembler, frames.slice(1)), artifactBytes)
  })

  it("drops collected chunks at the timeout and can start again", async () => {
    let now = 1_000
    const timeoutMilliseconds = TRANSFER_TIMEOUT_MINUTES_MIN * 60_000
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1),
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_MIN,
      now: () => now,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    now = 1_000 + timeoutMilliseconds - 1
    expect(assembler.state().kind).toBe("collecting")
    now = 1_000 + timeoutMilliseconds
    expect(assembler.state()).toEqual({ kind: "idle" })
    const restarted = await assembler.add(encodeFrameToPayload(frames[1]!))
    expect(restarted.kind).toBe("collecting")
    if (restarted.kind !== "collecting") throw new Error("unexpected state")
    expect([...restarted.receivedIndexes]).toEqual([1])
  })

  it("drops the frame that first observes an expired transfer", async () => {
    let now = 0
    const timeoutMilliseconds = TRANSFER_TIMEOUT_MINUTES_MIN * 60_000
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifactOfTotalBytes(FRAME_BYTES_MAX + 1),
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_MIN,
      now: () => now,
    })
    await assembler.add(encodeFrameToPayload(frames[0]!))
    now = timeoutMilliseconds + 1
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
      frameBytes: FRAME_BYTES_MAX,
    })
    expect(frames).toHaveLength(5)
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("rejects an artifact whose restored type differs from frame metadata", async () => {
    const artifactBytes = pseudoArtifact(100, "pq-public-identity")
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
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
      frameBytes: FRAME_BYTES_MAX,
    })
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expect(await addFrames(assembler, frames)).toEqual({
      kind: "error",
      code: "UNSUPPORTED_ALGORITHM",
    })
  })
})
