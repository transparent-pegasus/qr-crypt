import { describe, expect, it } from "vitest"
import { toBase64Url } from "@/lib/base64url"
import {
  FRAME_BYTES_VALUES,
  FRAME_CHUNK_MAX_BYTES,
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_VALUES,
  isBootReadableFrameBytes,
  isBootReadableFrameIntervalMs,
  isFrameBytes,
  isFrameIntervalMs,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
  normalizeLegacyFrameBytes,
  normalizeLegacyFrameIntervalMs,
  PROTOCOL_MAX_FRAMES,
  TRANSFER_TIMEOUT_MINUTES_DEFAULT,
  TRANSFER_TIMEOUT_MINUTES_MIN,
} from "@/lib/limits"
import {
  MAX_V2_PAYLOAD_CHARS,
  QR_PREFIX_V2,
  splitV2Payload,
} from "@/qr/payload-v2"

const MILLISECONDS_PER_MINUTE = 60_000
const ACCEPTED_BARE_V2_KINDS = ["pq-message", "pq-public-identity"] as const

describe("QR transfer timing safety budgets", () => {
  it("derives the minimum timeout from one slowest supported full cycle", () => {
    const minimumTimeoutMs =
      TRANSFER_TIMEOUT_MINUTES_MIN * MILLISECONDS_PER_MINUTE
    const slowestSupportedFullCycleMs =
      PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MAX
    const derivedMinimumMinutes = Math.ceil(
      slowestSupportedFullCycleMs / MILLISECONDS_PER_MINUTE,
    )

    expect(TRANSFER_TIMEOUT_MINUTES_MIN).toBe(derivedMinimumMinutes)
    expect(minimumTimeoutMs).toBeGreaterThanOrEqual(slowestSupportedFullCycleMs)
    expect(
      (TRANSFER_TIMEOUT_MINUTES_MIN - 1) * MILLISECONDS_PER_MINUTE,
    ).toBeLessThan(slowestSupportedFullCycleMs)
  })

  it("keeps one slowest full protocol cycle strictly below the default timeout", () => {
    const defaultTimeoutMs =
      TRANSFER_TIMEOUT_MINUTES_DEFAULT * MILLISECONDS_PER_MINUTE
    const slowestFullCycleMs = PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MAX

    expect(slowestFullCycleMs).toBeLessThan(defaultTimeoutMs)
  })
})

describe("persisted QR range compatibility", () => {
  it("keeps every active density and interval boot-readable and write-valid", () => {
    expect(FRAME_BYTES_VALUES).toEqual([
      100, 200, 300, 400, 500, 600, 700, 800, 900, 1_000,
    ])
    expect(FRAME_INTERVAL_MS_VALUES).toEqual([
      200, 300, 400, 500, 600, 700, 800, 900, 1_000, 2_000,
    ])

    for (const frameBytes of FRAME_BYTES_VALUES) {
      expect(isBootReadableFrameBytes(frameBytes)).toBe(true)
      expect(isFrameBytes(frameBytes)).toBe(true)
    }
    for (const frameIntervalMs of FRAME_INTERVAL_MS_VALUES) {
      expect(isBootReadableFrameIntervalMs(frameIntervalMs)).toBe(true)
      expect(isFrameIntervalMs(frameIntervalMs)).toBe(true)
    }
  })

  it.each([150, 250] as const)(
    "keeps retired density %i boot-readable while the active write validator rejects it",
    (frameBytes) => {
      expect(isBootReadableFrameBytes(frameBytes)).toBe(true)
      expect(isFrameBytes(frameBytes)).toBe(false)
    },
  )

  it("normalizes every historically stored density integer from 100 through 900", () => {
    for (let frameBytes = 100; frameBytes <= 900; frameBytes += 1) {
      expect(isBootReadableFrameBytes(frameBytes)).toBe(true)
      expect(normalizeLegacyFrameBytes(frameBytes)).toBe(
        Math.round(frameBytes / 100) * 100,
      )
    }
  })

  it.each([1_500, 2_500, 3_000] as const)(
    "keeps retired interval %i boot-readable while the active write validator rejects it",
    (frameIntervalMs) => {
      expect(isBootReadableFrameIntervalMs(frameIntervalMs)).toBe(true)
      expect(isFrameIntervalMs(frameIntervalMs)).toBe(false)
    },
  )

  it("normalizes every historically stored interval integer to the nearest active stop", () => {
    for (let frameIntervalMs = 150; frameIntervalMs <= 3_000; frameIntervalMs += 1) {
      expect(isBootReadableFrameIntervalMs(frameIntervalMs)).toBe(true)
      const expected =
        frameIntervalMs <= 1_000
          ? Math.max(200, Math.round(frameIntervalMs / 100) * 100)
          : frameIntervalMs < 1_500
            ? 1_000
            : 2_000
      expect(normalizeLegacyFrameIntervalMs(frameIntervalMs)).toBe(expected)
    }
  })
})

describe("bare v2 paste allocation ceiling", () => {
  it("pins the absolute receiver ceiling to the frame and chunk budgets", () => {
    expect(MAX_ARTIFACT_BYTES_ABSOLUTE).toBe(
      PROTOCOL_MAX_FRAMES * FRAME_CHUNK_MAX_BYTES,
    )
  })

  it("derives the character ceiling from the unpadded maximum artifact encoding", () => {
    const maximumArtifactBody = toBase64Url(
      new Uint8Array(MAX_ARTIFACT_BYTES_ABSOLUTE),
    )
    expect(maximumArtifactBody).toHaveLength(
      Math.ceil((MAX_ARTIFACT_BYTES_ABSOLUTE * 4) / 3),
    )
    for (const kind of ACCEPTED_BARE_V2_KINDS) {
      expect(MAX_V2_PAYLOAD_CHARS).toBe(
        QR_PREFIX_V2[kind].length + maximumArtifactBody.length,
      )
    }
  })

  it.each(ACCEPTED_BARE_V2_KINDS)(
    "accepts %s exactly at the paste ceiling and rejects one character beyond",
    (kind) => {
      const prefix = QR_PREFIX_V2[kind]
      const bodyAtLimit = "A".repeat(MAX_V2_PAYLOAD_CHARS - prefix.length)
      const payloadAtLimit = `${prefix}${bodyAtLimit}`

      expect(payloadAtLimit).toHaveLength(MAX_V2_PAYLOAD_CHARS)
      expect(splitV2Payload(payloadAtLimit)).toMatchObject({
        kind,
        bytes: expect.any(Uint8Array),
      })
      expect(splitV2Payload(payloadAtLimit).bytes).toHaveLength(
        MAX_ARTIFACT_BYTES_ABSOLUTE,
      )
      expect(() => splitV2Payload(`${payloadAtLimit}A`)).toThrow(
        "INVALID_QR_PAYLOAD",
      )
    },
  )
})
