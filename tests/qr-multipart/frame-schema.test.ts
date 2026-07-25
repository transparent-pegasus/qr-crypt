import { describe, expect, it } from "vitest"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { V2_ARTIFACT_TYPES } from "@/schemas/domain"
import {
  FRAME_CHUNK_MAX_BYTES,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  PROTOCOL_MAX_FRAMES,
} from "@/lib/limits"
import { validateQrFrameV2Strict } from "@/qr/multipart/frame-schema"

function validFrame(artifactType: V2ArtifactType = "pq-message"): QrFrameV2 {
  return {
    version: 2,
    type: "qr-frame",
    transferId: new Uint8Array(16),
    artifactType,
    frameIndex: 0,
    frameCount: 1,
    totalByteLength: 1,
    payloadSha256: new Uint8Array(32),
    chunk: Uint8Array.of(1),
  }
}

function expectInvalid(value: unknown): void {
  try {
    validateQrFrameV2Strict(value)
    throw new Error("expected validation to fail")
  } catch (error) {
    expect(error).toMatchObject({ code: "INVALID_QR_PAYLOAD" })
  }
}

describe("validateQrFrameV2Strict", () => {
  it.each(V2_ARTIFACT_TYPES)("accepts the strict %s frame shape", (artifactType) => {
    expect(validateQrFrameV2Strict(validFrame(artifactType))).toEqual(
      validFrame(artifactType),
    )
  })

  it("rejects unknown keys", () => {
    expectInvalid({ ...validFrame(), extra: 1 })
  })

  it("accepts the frame-count, chunk-byte, and total-byte protocol maxima", () => {
    expect(PROTOCOL_MAX_FRAMES).toBe(128)
    expect(FRAME_CHUNK_MAX_BYTES).toBe(200)
    expect(MAX_ARTIFACT_BYTES_ABSOLUTE).toBe(25_600)
    const frame = {
      ...validFrame(),
      frameIndex: PROTOCOL_MAX_FRAMES - 1,
      frameCount: PROTOCOL_MAX_FRAMES,
      totalByteLength: MAX_ARTIFACT_BYTES_ABSOLUTE,
      chunk: new Uint8Array(FRAME_CHUNK_MAX_BYTES),
    }
    expect(validateQrFrameV2Strict(frame)).toEqual(frame)
  })

  it.each([
    ["short transferId", { transferId: new Uint8Array(15) }],
    ["short hash", { payloadSha256: new Uint8Array(31) }],
    ["zero frameCount", { frameCount: 0 }],
    ["too many frames", { frameCount: PROTOCOL_MAX_FRAMES + 1 }],
    ["index equal to count", { frameIndex: 1 }],
    ["zero total length", { totalByteLength: 0 }],
    [
      "absolute total overflow",
      { totalByteLength: MAX_ARTIFACT_BYTES_ABSOLUTE + 1 },
    ],
    ["empty chunk", { chunk: new Uint8Array() }],
    [
      "oversize chunk",
      {
        chunk: new Uint8Array(FRAME_CHUNK_MAX_BYTES + 1),
        totalByteLength: FRAME_CHUNK_MAX_BYTES + 1,
      },
    ],
    ["chunk beyond total", { chunk: Uint8Array.of(1, 2), totalByteLength: 1 }],
    ["fractional index", { frameIndex: 0.5 }],
    ["unsafe total", { totalByteLength: Number.MAX_SAFE_INTEGER + 1 }],
    ["unknown artifact type", { artifactType: "unknown" }],
  ] satisfies ReadonlyArray<readonly [string, Readonly<Record<string, unknown>>]>)(
    "rejects %s",
    (_name, changes) => {
      expectInvalid({ ...validFrame(), ...changes })
    },
  )

  it("rejects non-plain object instances like the canonical guard", () => {
    const value = Object.assign(
      Object.create({ inherited: true }) as object,
      validFrame(),
    )
    expectInvalid(value)
  })
})
