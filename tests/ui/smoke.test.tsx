// Smoke test for the jsdom project and its environment.
import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

describe("ui environment smoke", () => {
  it("renders into jsdom with jest-dom matchers", () => {
    render(<main>smoke</main>)
    expect(screen.getByText("smoke")).toBeInTheDocument()
  })

  it("webcrypto subtle is available in the jsdom project", () => {
    expect(globalThis.crypto?.subtle).toBeDefined()
  })

  it("fake-indexeddb provides indexedDB", () => {
    expect(globalThis.indexedDB).toBeDefined()
  })
})
