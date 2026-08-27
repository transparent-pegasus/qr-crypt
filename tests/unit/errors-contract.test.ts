import { describe, expect, it } from "vitest"
import { AppError, ERROR_CODES, toAppError } from "@/crypto/errors"

describe("application error contract", () => {
  it("keeps errors code-only and preserves AppError instances", () => {
    expect(ERROR_CODES).toContain("KEY_ID_CONFLICT")
    expect(ERROR_CODES).toContain("MESSAGE_ID_REUSED")
    const error = new AppError("DECRYPTION_FAILED")
    expect(error.code).toBe("DECRYPTION_FAILED")
    expect(error).not.toHaveProperty("userMessage")
    expect(toAppError(new Error("x"), "STORAGE_FAILED").code).toBe("STORAGE_FAILED")
    expect(toAppError(error, "STORAGE_FAILED")).toBe(error)
  })
})
