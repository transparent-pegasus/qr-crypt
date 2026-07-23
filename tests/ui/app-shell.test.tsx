import "./helpers/module-mocks"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { fakeFeatures } from "./helpers/fakes"
import { setTestOnlineStatus } from "./helpers/network"
import { renderApp, resetUi } from "./helpers/render-app"

describe("app shell and feature gate", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("redirects / to /encrypt and renders four fixed safe-area nav items", async () => {
    await renderApp("/")
    await waitFor(() => expect(window.location.pathname).toBe("/encrypt"))

    const navigation = screen.getByRole("navigation", {
      name: "メインナビゲーション",
    })
    expect(navigation).toHaveClass("fixed", "bottom-0", "pb-safe")
    const links = within(navigation).getAllByRole("link")
    expect(links).toHaveLength(4)
    await waitFor(() => expect(links[0]).toHaveAttribute("aria-current", "page"))
    expect(links.map((link) => link.textContent)).toEqual(
      expect.arrayContaining(["暗号化現在のページ", "鍵", "保存済み", "設定"]),
    )
    expect(
      links.filter((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveLength(1)
    expect(links[0]).toHaveAttribute("aria-current", "page")
  })

  it("reports offline as neutral communication state without a safety claim", async () => {
    await renderApp("/encrypt")
    expect(await screen.findByText("オフライン")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("オフラインなので安全")
  })

  it("supports keyboard navigation with visible-focus classes and Space activation", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    const navigation = await screen.findByRole("navigation", {
      name: "メインナビゲーション",
    })
    const links = within(navigation).getAllByRole("link")
    for (const link of links) expect(link).toHaveClass("focus-visible:ring-2")

    links[1]?.focus()
    expect(links[1]).toHaveFocus()
    await user.keyboard(" ")
    await waitFor(() => expect(window.location.pathname).toBe("/keys"))
    expect(links[1]).toHaveAttribute("aria-current", "page")

    links[3]?.focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(window.location.pathname).toBe("/settings"))
  })

  it("reaches navigation items by Tab in their visual order", async () => {
    const { BottomNavigation } = await import("@/components/bottom-navigation")
    const { MemoryRouter } = await import("react-router-dom")
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/encrypt"]}>
        <button type="button">開始位置</button>
        <BottomNavigation />
      </MemoryRouter>,
    )
    await user.tab()
    expect(screen.getByRole("button", { name: "開始位置" })).toHaveFocus()
    const links = screen
      .getByRole("navigation", {
        name: "メインナビゲーション",
      })
      .querySelectorAll("a")
    for (const link of links) {
      await user.tab()
      expect(link).toHaveFocus()
    }
  })

  it("blocks all features when Web Crypto is missing", async () => {
    setTestOnlineStatus(true)
    await renderApp("/encrypt", {
      detectFeatures: () => ({
        webCrypto: false,
        indexedDb: true,
        camera: true,
        serviceWorker: true,
      }),
    })
    expect(await screen.findByText("UNSUPPORTED_BROWSER")).toBeInTheDocument()
    expect(screen.getByText("このブラウザーでは利用できません")).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(
      screen.queryByText("オンラインではPWAの導入のみ利用できます"),
    ).not.toBeInTheDocument()
  })

  it("keeps the app available but disables camera reading when camera is absent", async () => {
    Object.assign(fakeFeatures, { camera: false })
    const user = userEvent.setup()
    await renderApp("/encrypt", {
      detectFeatures: () => ({ ...fakeFeatures }),
    })
    await user.click(await screen.findByRole("tab", { name: "復号" }))
    expect(
      screen.getByRole("button", { name: "暗号文QRを読み取る" }),
    ).toBeDisabled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "この端末ではカメラを利用できません。ペイロードを貼り付けてください。",
      ),
    ).toBeInTheDocument()
  })
})
