import { describe, expect, it } from "vitest"
import {
  MAX_PLAINTEXT_BYTES,
  MAX_PQ_PLAINTEXT_BYTES,
  MAX_SYM_PLAINTEXT_BYTES,
} from "@/lib/limits"
import { env, parseAppEnv } from "@/schemas/env-schema"

describe("environment contract", () => {
  it("applies defaults and rejects invalid values and retired algorithms", () => {
    expect(env.maxPlaintextBytes).toBe(120_000)
    expect(MAX_PQ_PLAINTEXT_BYTES).toBe(env.maxPlaintextBytes)
    // The shared allocation ceiling must not drift off the PQ ceiling; typecheck
    // does not catch a later edit that reassigns it.
    expect(MAX_PLAINTEXT_BYTES).toBe(MAX_PQ_PLAINTEXT_BYTES)
    // Sym-v2 is deliberately capped to one frame, independently of the PQ
    // multipart allocation ceiling.
    expect(MAX_SYM_PLAINTEXT_BYTES).toBe(853)
    expect(MAX_SYM_PLAINTEXT_BYTES).toBeLessThan(MAX_PQ_PLAINTEXT_BYTES)
    const normalized = parseAppEnv({})
    expect(normalized.qrFrameBytes).toBe(1_000)
    expect(normalized.qrFrameIntervalMs).toBe(200)
    expect(normalized.autoClearSeconds).toBe(60)
    expect(normalized.autoClearFallbackSeconds).toBe(300)
    for (const frameIntervalMs of [199, 250, 1_001, 1_500, 3_000]) {
      expect(() =>
        parseAppEnv({
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }),
      ).toThrow("Invalid environment variables")
    }
    expect(() => parseAppEnv({ VITE_QR_RENDER_SIZE: "abc" })).toThrow(
      "Invalid environment variables",
    )
    for (const removedAlgorithm of [
      "MLKEM768_A256GCM",
      "MLKEM768_MLDSA65_A256GCM",
      "MLKEM1024_A256GCM",
    ]) {
      expect(() => parseAppEnv({ VITE_DEFAULT_ALGORITHM: removedAlgorithm })).toThrow(
        "Invalid environment variables",
      )
    }
  })

  it.each([
    [1_000, 200],
    [100, 2_000],
  ] as const)(
    "accepts the complete %iB/%ims display pair",
    (frameBytes, frameIntervalMs) => {
      expect(
        parseAppEnv({
          VITE_QR_FRAME_BYTES: String(frameBytes),
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }),
      ).toMatchObject({ qrFrameBytes: frameBytes, qrFrameIntervalMs: frameIntervalMs })
    },
  )

  it.each([
    [100, 200],
    [1_000, 2_000],
    [200, 200],
    [900, 200],
    [100, 1_000],
    [1_000, 300],
    [500, 500],
  ] as const)(
    "rejects the nonpair %iB/%ims even when both fields are individually valid",
    (frameBytes, frameIntervalMs) => {
      expect(() =>
        parseAppEnv({
          VITE_QR_FRAME_BYTES: String(frameBytes),
          VITE_QR_FRAME_INTERVAL_MS: String(frameIntervalMs),
        }),
      ).toThrow("Invalid environment variables")
    },
  )

  it.each([{ VITE_QR_FRAME_BYTES: "100" }, { VITE_QR_FRAME_INTERVAL_MS: "2000" }])(
    "rejects a partial compatible preference rather than silently filling its partner: %j",
    (raw) => {
      expect(() => parseAppEnv(raw)).toThrow("Invalid environment variables")
    },
  )

  it.each([
    ["VITE_APP_NAME", "QR Crypt"],
    ["VITE_APP_SHORT_NAME", "QR Crypt"],
    ["VITE_PQ_PROVIDER", "noble"],
    ["VITE_ENABLE_ML_KEM", "true"],
    ["VITE_ENABLE_ML_DSA", "true"],
    ["VITE_PQ_WORKER_ENABLED", "true"],
  ] as const)("rejects the removed environment key %s", (key, value) => {
    expect(() => parseAppEnv({ [key]: value })).toThrow(
      `Invalid environment variables: ${key}`,
    )
  })

  it("does not expose branding, provider, or PQ feature switches as environment policy", () => {
    const parsed = parseAppEnv({})
    for (const property of [
      "appName",
      "appShortName",
      "pqProvider",
      "enableMlKem",
      "enableMlDsa",
      "pqWorkerEnabled",
    ]) {
      expect(parsed).not.toHaveProperty(property)
    }
  })

  it("omits retired post-quantum preferences from the parsed environment", () => {
    const parsed = parseAppEnv({})
    expect(parsed).not.toHaveProperty("defaultPqProfile")
    expect(parsed).not.toHaveProperty("requireSignature")
  })

  it.each([
    ["VITE_DEFAULT_PQ_PROFILE", "maximum"],
    ["VITE_REQUIRE_SIGNATURE", "false"],
  ] as const)("rejects retired environment identifier %s", (identifier, value) => {
    expect(() => parseAppEnv({ [identifier]: value })).toThrow(
      `Invalid environment variables: ${identifier}`,
    )
  })

  it.each(["false", "yes"] as const)("rejects retired VITE_ENABLE_RSA=%s", (value) => {
    expect(() => parseAppEnv({ VITE_ENABLE_RSA: value })).toThrow(
      /^Invalid environment variables: VITE_ENABLE_RSA$/u,
    )
  })
})
