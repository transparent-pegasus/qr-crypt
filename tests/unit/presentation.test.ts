import { describe, expect, it } from "vitest"
import { formatDateTime } from "@/features/presentation"

describe("presentation formatting", () => {
  it("returns a fallback string for an out-of-range safe-integer timestamp", () => {
    const formatted = formatDateTime(Number.MAX_SAFE_INTEGER, "en")

    expect(formatted).toEqual(expect.any(String))
    expect(formatted.length).toBeGreaterThan(0)
  })
})
