import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { syntheticRelayPlayback } from "../fixtures/relay-playback"
import { deferred } from "../helpers/deferred"

const renderQr = vi.hoisted(() => vi.fn<(payload: string) => Promise<string>>())
vi.mock("@/qr/encode", () => ({ renderQrDataUrl: renderQr }))

import { prepareRelayPlayback } from "@/qr/relay-playback"

// The optional signal is the approved public interface. This callable type also
// lets BASE run the behavioral regressions before that argument is implemented.
const prepare: (
  text: string,
  signal?: AbortSignal,
) => ReturnType<typeof prepareRelayPlayback> = prepareRelayPlayback

const fixture = syntheticRelayPlayback()

beforeEach(() => {
  renderQr.mockResolvedValue("data:image/png;base64,cHVibGlj")
})

afterEach(() => {
  vi.resetAllMocks()
})

describe("relay playback preparation", () => {
  it("validates the complete input before starting a render", async () => {
    const result = await prepare(`${fixture.text}\nOCF2:invalid`)
    expect(result).toMatchObject({ ok: false, reason: "parse" })
    expect(renderQr).not.toHaveBeenCalled()
  })

  it("keeps only one frame render in flight", async () => {
    const first = deferred<string>()
    renderQr.mockReturnValueOnce(first.promise)
    const preparation = prepare(fixture.text)
    try {
      expect(renderQr).toHaveBeenCalledTimes(1)
    } finally {
      first.resolve("data:image/png;base64,cHVibGlj")
      await preparation
    }
  })

  it("allows a real timer task to progress before rendering the next frame", async () => {
    const order: string[] = []
    const timer = deferred<void>()
    renderQr.mockImplementation(async (payload) => {
      const index = fixture.payloads.indexOf(payload)
      order.push(`render ${index}`)
      if (index === 0) {
        setTimeout(() => {
          order.push("timer")
          timer.resolve()
        }, 0)
      }
      return "data:image/png;base64,cHVibGlj"
    })

    expect(await prepare(fixture.text)).toEqual({ ok: true, frames: fixture.frames })
    await timer.promise
    expect(order).toEqual(["render 0", "timer", "render 1", "render 2"])
  })

  it("does not render when its signal was already aborted", async () => {
    const cancellation = new AbortController()
    cancellation.abort()

    expect(await prepare(fixture.text, cancellation.signal)).toEqual({
      ok: false,
      reason: "cancelled",
    })
    expect(renderQr).not.toHaveBeenCalled()
  })

  it("stops before the next render when cancelled by a timer task", async () => {
    const cancellation = new AbortController()
    const timer = deferred<void>()
    renderQr.mockImplementation(async () => {
      setTimeout(() => {
        cancellation.abort()
        timer.resolve()
      }, 0)
      return "data:image/png;base64,cHVibGlj"
    })

    const result = await prepare(fixture.text, cancellation.signal)
    await timer.promise
    expect(result).toEqual({ ok: false, reason: "cancelled" })
    expect(renderQr).toHaveBeenCalledTimes(1)
  })

  it.each(["resolve", "reject"] as const)(
    "suppresses an in-flight render's late %s after cancellation",
    async (outcome) => {
      const cancellation = new AbortController()
      const first = deferred<string>()
      renderQr.mockReturnValueOnce(first.promise)
      const preparation = prepare(fixture.text, cancellation.signal)
      cancellation.abort()
      if (outcome === "resolve") first.resolve("data:image/png;base64,cHVibGlj")
      else first.reject(new Error("late renderer detail"))

      expect(await preparation).toEqual({ ok: false, reason: "cancelled" })
      expect(renderQr).toHaveBeenCalledTimes(1)
    },
  )

  it("rejects the whole set when a later frame cannot render", async () => {
    const last = deferred<string>()
    renderQr.mockImplementation(async (payload) => {
      if (payload === fixture.payloads[2]) return last.promise
      return "data:image/png;base64,cHVibGlj"
    })
    const preparation = prepare(fixture.text)
    let settled = false
    void preparation.then(() => {
      settled = true
    })
    await vi.waitFor(() => expect(renderQr).toHaveBeenCalledTimes(3))
    expect(settled).toBe(false)
    last.reject(new Error("unrenderable later frame"))

    expect(await preparation).toEqual({ ok: false, reason: "render" })
  })

  it("returns decoded frames for a complete 128-frame set", async () => {
    const full = syntheticRelayPlayback(128)
    const result = await prepare(full.text)

    expect(result).toEqual({ ok: true, frames: full.frames })
    expect(renderQr.mock.calls.map(([payload]) => payload)).toEqual(full.payloads)
  })
})
