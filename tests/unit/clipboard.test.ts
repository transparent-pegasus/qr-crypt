import { afterEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/crypto/errors"
import { copyTextToClipboard } from "@/lib/clipboard"

describe("copyTextToClipboard", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("writes the text through navigator.clipboard", async () => {
    const writeText = vi.fn(async () => undefined)
    vi.stubGlobal("navigator", { clipboard: { writeText } })
    await copyTextToClipboard("payload-text")
    expect(writeText).toHaveBeenCalledWith("payload-text")
  })

  it("maps a clipboard failure to AppError STORAGE_FAILED", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: vi.fn(async () => {
          throw new Error("denied")
        }),
      },
    })
    const failure = copyTextToClipboard("x")
    await expect(failure).rejects.toBeInstanceOf(AppError)
    await expect(failure).rejects.toMatchObject({ code: "STORAGE_FAILED" })
  })
})
