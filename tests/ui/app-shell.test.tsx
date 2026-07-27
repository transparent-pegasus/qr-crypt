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
      name: "Main navigation",
    })
    expect(navigation).toHaveClass("fixed", "bottom-0", "pb-safe")
    const links = within(navigation).getAllByRole("link")
    expect(links).toHaveLength(4)
    await waitFor(() => expect(links[0]).toHaveAttribute("aria-current", "page"))
    for (const name of ["Encrypt", "Decrypt", "Keys", "Settings"]) {
      expect(within(navigation).getByRole("link", { name })).toHaveAttribute(
        "aria-label",
        name,
      )
    }
    expect(
      links.filter((link) => link.getAttribute("aria-current") === "page"),
    ).toHaveLength(1)
    expect(links[0]).toHaveAttribute("aria-current", "page")
  })

  it("reports offline as neutral communication state without a safety claim", async () => {
    await renderApp("/encrypt")
    expect(await screen.findByText("Offline")).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent("Offline means safe")
  })

  it("supports keyboard navigation with visible-focus classes and Space activation", async () => {
    const user = userEvent.setup()
    await renderApp("/encrypt")
    const navigation = await screen.findByRole("navigation", {
      name: "Main navigation",
    })
    const links = within(navigation).getAllByRole("link")
    for (const link of links) expect(link).toHaveClass("focus-visible:ring-2")

    links[1]?.focus()
    expect(links[1]).toHaveFocus()
    await user.keyboard(" ")
    await waitFor(() => expect(window.location.pathname).toBe("/decrypt"))
    expect(links[1]).toHaveAttribute("aria-current", "page")

    links[3]?.focus()
    await user.keyboard("{Enter}")
    await waitFor(() => expect(window.location.pathname).toBe("/settings"))
  })

  it("reaches navigation items by Tab in their visual order", async () => {
    const { BottomNavigation } = await import("@/components/bottom-navigation")
    const { MemoryRouter } = await import("react-router")
    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={["/encrypt"]}>
        <button type="button">Start</button>
        <BottomNavigation />
      </MemoryRouter>,
    )
    await user.tab()
    expect(screen.getByRole("button", { name: "Start" })).toHaveFocus()
    const links = screen
      .getByRole("navigation", {
        name: "Main navigation",
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
    expect(screen.getByText("This browser is not supported")).toBeInTheDocument()
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument()
    expect(
      screen.queryByText("Install the PWA or relay OCF2 message-header QR frames"),
    ).not.toBeInTheDocument()
  })

  it("keeps the app available but disables camera reading when camera is absent", async () => {
    Object.assign(fakeFeatures, { camera: false })
    await renderApp("/decrypt", {
      detectFeatures: () => ({ ...fakeFeatures }),
    })
    expect(
      await screen.findByRole("button", { name: "Scan a ciphertext QR code" }),
    ).toBeDisabled()
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    expect(
      screen.getByText(
        "The camera is unavailable on this device. Paste the payload instead.",
      ),
    ).toBeInTheDocument()
  })
})
