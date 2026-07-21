// jsdom プロジェクトの smoke テスト(plan §13 C2)。
// WP-3 が本格的な UI テストを追加するまでの環境検証を兼ねる。
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
