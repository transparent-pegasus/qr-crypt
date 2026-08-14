import { afterEach, describe, expect, it, vi } from "vitest"
import { AppError } from "@/crypto/errors"
import { copyImageToClipboard, copyTextToClipboard } from "@/lib/clipboard"
import { fromStandardBase64 } from "@/lib/base64url"

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

describe("copyImageToClipboard", () => {
  afterEach(() => vi.unstubAllGlobals())

  it("writes the decoded PNG through navigator.clipboard as a ClipboardItem", async () => {
    class FakeClipboardItem {
      constructor(readonly parts: Record<string, Blob>) {}
    }
    const write = vi.fn(async () => undefined)
    vi.stubGlobal("ClipboardItem", FakeClipboardItem)
    vi.stubGlobal("navigator", { clipboard: { write } })

    await copyImageToClipboard(`data:image/png;base64,${btoa("png-bytes")}`)

    expect(write).toHaveBeenCalledOnce()
    const [items] = write.mock.calls[0] as unknown as [FakeClipboardItem[]]
    const item = items[0]
    expect(item).toBeInstanceOf(FakeClipboardItem)
    const blob = item!.parts["image/png"]
    expect(blob).toBeInstanceOf(Blob)
    expect(blob!.type).toBe("image/png")
    expect(await blob!.text()).toBe("png-bytes")
  })

  it("maps a clipboard write failure to AppError STORAGE_FAILED", async () => {
    class FakeClipboardItem {
      constructor(readonly parts: Record<string, Blob>) {}
    }
    vi.stubGlobal("ClipboardItem", FakeClipboardItem)
    vi.stubGlobal("navigator", {
      clipboard: {
        write: vi.fn(async () => {
          throw new Error("denied")
        }),
      },
    })
    const failure = copyImageToClipboard(`data:image/png;base64,${btoa("x")}`)
    await expect(failure).rejects.toBeInstanceOf(AppError)
    await expect(failure).rejects.toMatchObject({ code: "STORAGE_FAILED" })
  })

  it("maps malformed data-URL base64 to AppError STORAGE_FAILED without writing", async () => {
    const write = vi.fn(async () => undefined)
    vi.stubGlobal("ClipboardItem", class {})
    vi.stubGlobal("navigator", { clipboard: { write } })
    const failure = copyImageToClipboard("data:image/png;base64,@@not-base64@@")
    await expect(failure).rejects.toMatchObject({ code: "STORAGE_FAILED" })
    expect(write).not.toHaveBeenCalled()
  })
})

describe("fromStandardBase64", () => {
  it("decodes standard base64 to a Uint8Array", () => {
    const decoded = fromStandardBase64(btoa("png-bytes"))

    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(decoded).toEqual(
      new Uint8Array([112, 110, 103, 45, 98, 121, 116, 101, 115]),
    )
  })

  it("exposes a decoder that throws TypeError on invalid input", () => {
    expect(fromStandardBase64).toBeTypeOf("function")
    expect(() => fromStandardBase64("@@not-base64@@")).toThrow(TypeError)
  })
})
