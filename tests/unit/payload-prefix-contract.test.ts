import { describe, expect, it } from "vitest"
import { QR_PREFIX_V2 } from "@/qr/payload-v2"

describe("payload prefix contract", () => {
  it("payload prefixes expose only the v2 wire family", () => {
    expect(QR_PREFIX_V2["sym-message"]).toBe("OCA2:")
    expect(QR_PREFIX_V2["symmetric-key"]).toBe("OCK2:")
  })
})
