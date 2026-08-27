import { vi } from "vitest"
import {
  nextArtifactCounter,
  nextKeyCounter,
  resetFakeCounters,
} from "./counters"
import { cryptoKey } from "./key-fixtures"
import { registerFakeReset } from "./reset"

export const sha256 = vi.fn(async (value: Uint8Array) => {
  const result = new Uint8Array(32)
  result[0] = value.byteLength % 256
  return result
})
export const sha256Hex = vi.fn(async (value: Uint8Array) =>
  value.byteLength.toString(16).padStart(64, "0"),
)

export const generateArtifactId = vi.fn(
  () => `artifact-${String(nextArtifactCounter()).padStart(8, "0")}`,
)
export const generateKeyId = vi.fn(
  () => `generated-key-${String(nextKeyCounter()).padStart(8, "0")}`,
)
export const shortId = vi.fn((value: string) => value.slice(0, 8))
export const randomBytes = vi.fn((length: number) => new Uint8Array(length))
export const getOrCreateVaultKey = vi.fn(async () => cryptoKey())

registerFakeReset(resetFakeCounters)
