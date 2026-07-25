import { describe, expect, it } from "vitest"
import type { QrFrameV2 } from "@/schemas/domain"
import { encodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"
import { sha256 } from "@/lib/bytes"
import {
  FRAME_BYTES_MAX,
  FRAME_BYTES_VALUES,
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  PROTOCOL_MAX_FRAMES,
  TRANSFER_TIMEOUT_MINUTES_DEFAULT,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
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
    expect(frames[0]!.payloadSha256).toEqual(await sha256(artifactBytes))
    expect(frames[0]!.chunk).toEqual(artifactBytes)
  })

  it("splits directly at the configured raw-byte boundary", async () => {
    const artifactBytes = pseudoArtifact(300)
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

  it("balances an explicit frame count with non-empty byte-exact chunks", async () => {
    const artifactBytes = pseudoArtifact(1_000)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameCount: 7,
    })

    expect(frames).toHaveLength(7)
    const chunkLengths = frames.map((frame) => frame.chunk.byteLength)
    expect(Math.max(...chunkLengths) - Math.min(...chunkLengths)).toBeLessThanOrEqual(1)
    expect(
      chunkLengths.every(
        (length) => length > 0 && length <= FRAME_CHUNK_MAX_BYTES,
      ),
    ).toBe(true)
    const reconstructed = new Uint8Array(artifactBytes.byteLength)
    let offset = 0
    for (const frame of frames) {
      reconstructed.set(frame.chunk, offset)
      offset += frame.chunk.byteLength
    }
    expect(reconstructed).toEqual(artifactBytes)
    expect(framePayloads(frames).every((payload) => payloadFits(payload, "Q"))).toBe(
      true,
    )
  })

  it("supports one-byte balanced chunks without creating empty frames", async () => {
    const artifactBytes = Uint8Array.of(1, 2, 3, 4)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameCount: artifactBytes.byteLength,
    })
    expect(frames.map((frame) => frame.chunk.byteLength)).toEqual([1, 1, 1, 1])
    expect(frames.map((frame) => frame.chunk[0])).toEqual([1, 2, 3, 4])
  })

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "rejects invalid frameCount=%s",
    async (frameCount) => {
      await expect(
        splitIntoFrames({
          artifactType: "pq-message",
          artifactBytes: pseudoArtifact(100),
          frameCount,
        }),
      ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
    },
  )

  it("rejects counts above the artifact length, env limit, or 200-byte chunk limit", async () => {
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: Uint8Array.of(1, 2),
        frameCount: 3,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: new Uint8Array(PROTOCOL_MAX_FRAMES + 1),
        frameCount: PROTOCOL_MAX_FRAMES + 1,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes: new Uint8Array(FRAME_CHUNK_MAX_BYTES * 2 + 1),
        frameCount: 2,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
  })

  it("rejects selecting both split modes or neither mode at runtime", async () => {
    const common = {
      artifactType: "pq-message" as const,
      artifactBytes: pseudoArtifact(100),
    }
    await expect(
      splitIntoFrames({
        ...common,
        frameBytes: FRAME_BYTES_MAX,
        frameCount: 1,
      } as never),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
    await expect(splitIntoFrames(common as never)).rejects.toMatchObject({
      code: "QR_TOO_LARGE",
    })
  })

  it("round-trips exactly 128 frames at the protocol limit", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(MAX_ARTIFACT_BYTES_ABSOLUTE)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    expect(MAX_ARTIFACT_BYTES_ABSOLUTE).toBe(25_600)
    expect(frames).toHaveLength(PROTOCOL_MAX_FRAMES)
    expect(frames.at(-1)?.frameIndex).toBe(PROTOCOL_MAX_FRAMES - 1)

    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it.each(FRAME_BYTES_VALUES)(
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

      const assembler = new TransferAssembler({
        transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
      })
      expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
    },
  )

  it("rejects transfers over env.qrMaxFrames", async () => {
    const artifactBytes = pseudoArtifactOfTotalBytes(
      MAX_ARTIFACT_BYTES_ABSOLUTE + 1,
    )
    expect(artifactBytes).toHaveLength(25_601)
    await expect(
      splitIntoFrames({
        artifactType: "pq-message",
        artifactBytes,
        frameBytes: FRAME_BYTES_MAX,
      }),
    ).rejects.toMatchObject({ code: "QR_TOO_LARGE" })
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
    [
      "one-hundred-twenty-eight",
      MAX_ARTIFACT_BYTES_ABSOLUTE,
      PROTOCOL_MAX_FRAMES,
    ],
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
    const artifactBytes = pseudoArtifact(300)
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
      artifactBytes: pseudoArtifact(500),
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
    const first = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: FRAME_BYTES_MAX,
    })
    const second = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(600),
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
    expectCompleteBytes(await addFrames(assembler, second), pseudoArtifact(600))
  })

  it("detects a changed unique chunk through the final SHA-256", async () => {
    const artifactBytes = pseudoArtifact(300)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    const changedChunk = Uint8Array.from(frames[1]!.chunk)
    changedChunk[0] = changedChunk[0]! ^ 1
    const changedFrames = [frames[0]!, { ...frames[1]!, chunk: changedChunk }]
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expect(await addFrames(assembler, changedFrames)).toEqual({
      kind: "error",
      code: "INVALID_QR_PAYLOAD",
    })
  })

  it("detects a consistently wrong whole-payload hash", async () => {
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes: pseudoArtifact(500),
      frameBytes: FRAME_BYTES_MAX,
    })
    const wrongHash = new Uint8Array(32).fill(0xff)
    const changedFrames = frames.map((frame) => ({
      ...frame,
      payloadSha256: Uint8Array.from(wrongHash),
    }))
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
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
      artifactBytes: pseudoArtifact(500),
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
      artifactBytes: pseudoArtifact(500),
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
    expect(frames).toHaveLength(25)
    const assembler = new TransferAssembler({
      transferTimeoutMinutes: TRANSFER_TIMEOUT_MINUTES_DEFAULT,
    })
    expectCompleteBytes(await addFrames(assembler, frames), artifactBytes)
  })

  it("handles an 8.9KB artifact representing a 4096-byte plaintext", async () => {
    const artifactBytes = pseudoArtifact(8_850)
    const frames = await splitIntoFrames({
      artifactType: "pq-message",
      artifactBytes,
      frameBytes: FRAME_BYTES_MAX,
    })
    expect(frames).toHaveLength(45)
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
