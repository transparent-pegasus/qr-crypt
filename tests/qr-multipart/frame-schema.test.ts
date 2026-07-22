import { describe, expect, it } from "vitest"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"
import { V2_ARTIFACT_TYPES } from "@/schemas/domain"
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

  it.each([
    ["short transferId", { transferId: new Uint8Array(15) }],
    ["short hash", { payloadSha256: new Uint8Array(31) }],
    ["zero frameCount", { frameCount: 0 }],
    ["too many frames", { frameCount: 65 }],
    ["index equal to count", { frameIndex: 1 }],
    ["zero total length", { totalByteLength: 0 }],
    ["absolute total overflow", { totalByteLength: 57_601 }],
    ["empty chunk", { chunk: new Uint8Array() }],
    ["oversize chunk", { chunk: new Uint8Array(901), totalByteLength: 901 }],
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
