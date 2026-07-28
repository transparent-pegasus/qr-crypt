// Smoke test for the jsdom project and its environment.
import { describe, expect, it } from "vitest"

describe("jsdom setup contract", () => {
  it("webcrypto subtle is available in the jsdom project", () => {
    expect(globalThis.crypto?.subtle).toBeDefined()
  })

  it("fake-indexeddb provides indexedDB", () => {
    expect(globalThis.indexedDB).toBeDefined()
  })
})
