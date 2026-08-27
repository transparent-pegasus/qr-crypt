import { describe, expect, it } from "vitest"
import {
  DELETE_ALL_CONFIRMATION,
  DISABLE_WIPE_CONFIRMATION,
  KEEP_KEYS_CONFIRMATION,
} from "@/pages/settings-confirmations"

describe("settings confirmation phrases", () => {
  it("pins the destructive ceremony literals", () => {
    expect(DELETE_ALL_CONFIRMATION).toBe("DELETE ALL")
    expect(KEEP_KEYS_CONFIRMATION).toBe("KEEP KEYS")
    expect(DISABLE_WIPE_CONFIRMATION).toBe("DISABLE WIPE")
  })
})
