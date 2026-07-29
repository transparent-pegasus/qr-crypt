import { describe, expect, it } from "vitest"
import { decodeCanonicalCbor, encodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"

describe("canonical CBOR structural caps", () => {
  it("rejects a canonical map with more entries than any protocol shape (9 > 8)", () => {
    const value: Record<string, number> = {}
    for (let index = 0; index < 9; index += 1) value[`k${index}`] = index
    const bytes = encodeCanonicalCbor(value)
    expect(() => decodeCanonicalCbor(bytes)).toThrow()
  })

  it("still accepts the largest active shape size (8 entries)", () => {
    const value: Record<string, number> = {}
    for (let index = 0; index < 8; index += 1) value[`k${index}`] = index
    expect(decodeCanonicalCbor(encodeCanonicalCbor(value))).toEqual(value)
  })
})
