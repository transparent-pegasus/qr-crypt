// This file isolates the pure entry-count boundary: 9 rejected, 8 accepted on a generic map.
// The golden file's cap tests sit at maximum artifact size with ten top-level entries.
import { describe, expect, it } from "vitest"
import { AppError } from "@/crypto/errors"
import { decodeCanonicalCbor, encodeCanonicalCbor } from "@/crypto/pq/canonical-cbor"

describe("canonical CBOR structural caps", () => {
  it("rejects a canonical map with more entries than any protocol shape (9 > 8)", () => {
    const value: Record<string, number> = {}
    for (let index = 0; index < 9; index += 1) value[`k${index}`] = index
    const bytes = encodeCanonicalCbor(value)
    let caught: unknown
    try {
      decodeCanonicalCbor(bytes)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(AppError)
    expect((caught as AppError).code).toBe("INVALID_QR_PAYLOAD")
  })

  it("still accepts the largest active shape size (8 entries)", () => {
    const value: Record<string, number> = {}
    for (let index = 0; index < 8; index += 1) value[`k${index}`] = index
    expect(decodeCanonicalCbor(encodeCanonicalCbor(value))).toEqual(value)
  })
})
