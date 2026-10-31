import "./helpers/module-mocks/feature-detection"
import "./helpers/module-mocks/pwa"
import "./helpers/module-mocks/preferences"
import "./helpers/module-mocks/crypto-runtime"
import "./helpers/module-mocks/symmetric-crypto"
import "./helpers/module-mocks/pq-crypto"
import "./helpers/module-mocks/qr-codec"
import "./helpers/module-mocks/qr-scanner"
import "./helpers/module-mocks/key-records"
import "./helpers/module-mocks/pq-records"
import { screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { renderApp, resetUi } from "./helpers/render-app"

function expectPrivateInputHints(field: HTMLElement): void {
  for (const [attribute, value] of [
    ["spellcheck", "false"],
    ["autocomplete", "off"],
    ["autocorrect", "off"],
    ["autocapitalize", "off"],
    ["writingsuggestions", "false"],
  ] as const) {
    expect.soft(field).toHaveAttribute(attribute, value)
  }
}

describe("sensitive input browser hints", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it.each([
    ["/encrypt", "Plaintext"],
    ["/decrypt", "Ciphertext payload"],
  ] as const)("sets all five hints on the actual %s field", async (route, label) => {
    await renderApp(route)
    expectPrivateInputHints(await screen.findByLabelText(label))
  })

  it("sets all five hints on the key-import paste field that can contain a shared secret", async () => {
    const user = userEvent.setup()
    await renderApp("/keys")
    await user.click(await screen.findByRole("tab", { name: "Other parties' keys" }))
    await user.click(screen.getByRole("button", { name: "Scan a key QR" }))

    expectPrivateInputHints(await screen.findByLabelText("Key payload"))
  })
})
