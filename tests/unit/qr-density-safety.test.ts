import { describe, expect, it } from "vitest"
import { toBase64Url } from "@/lib/base64url"
import {
  FRAME_INTERVAL_MS_MAX,
  FRAME_INTERVAL_MS_MIN,
  MAX_ARTIFACT_BYTES_ABSOLUTE,
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
const ACCEPTED_BARE_V2_KINDS = [
  "pq-message",
  "pq-kem-public-key",
  "pq-dsa-public-key",
  "pq-public-identity",
] as const

describe("QR transfer timing safety budgets", () => {
  it("lets the legal minimum timeout cover one fastest full protocol cycle", () => {
    const minimumTimeoutMs =
      TRANSFER_TIMEOUT_MINUTES_MIN * MILLISECONDS_PER_MINUTE
    const fastestFullCycleMs = PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MIN

    expect(minimumTimeoutMs).toBeGreaterThanOrEqual(fastestFullCycleMs)
  })

  it("keeps one slowest full protocol cycle strictly below the default timeout", () => {
    const defaultTimeoutMs =
      TRANSFER_TIMEOUT_MINUTES_DEFAULT * MILLISECONDS_PER_MINUTE
    const slowestFullCycleMs = PROTOCOL_MAX_FRAMES * FRAME_INTERVAL_MS_MAX

    expect(slowestFullCycleMs).toBeLessThan(defaultTimeoutMs)
  })
})

describe("bare v2 paste allocation ceiling", () => {
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
