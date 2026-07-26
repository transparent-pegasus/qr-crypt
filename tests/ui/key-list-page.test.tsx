import "./helpers/module-mocks"
import { useState } from "react"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders, useSensitiveSession } from "@/app/providers"
import type { KeySelection } from "@/components/key-detail-dialog"
import { LanguageProvider } from "@/i18n"
import {
  deleteBundle,
  deleteIdentity,
  deleteKeyRecord,
  fakeBundles,
  fakeFeatures,
  fakeIdentities,
  fakeKeys,
  listIdentities,
  listKeyRecords,
  renderQrDataUrl,
  revokeIdentity,
  saveRotation,
  splitIntoFrames,
  updatePreferences,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

let KeyDetailDialog: typeof import("@/components/key-detail-dialog").KeyDetailDialog

beforeAll(async () => {
  ;({ KeyDetailDialog } = await import("@/components/key-detail-dialog"))
})

function rowFor(text: string): HTMLButtonElement {
  const row = screen.getByText(text).closest("button")
  if (!(row instanceof HTMLButtonElement)) throw new Error(`row not found: ${text}`)
  return row
}

function expectSingleAlertCancelWithoutClose(dialog: HTMLElement): void {
  expect(
    within(dialog).getAllByRole("button", { name: "Cancel" }),
  ).toHaveLength(1)
  expect(
    within(dialog).queryByRole("button", { name: "Close" }),
  ).toBeNull()
  expect(dialog.querySelector("svg.lucide-x")).toBeNull()
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

async function renderKeyList(): Promise<void> {
  await renderApp("/saved")
  await screen.findByRole("heading", { name: "Key list" })
}

function SensitiveStateProbe() {
  const { secretVisible } = useSensitiveSession()
  return <output data-testid="secret-visible">{String(secretVisible)}</output>
}

function SymmetricDetailHarness() {
  const [selection, setSelection] = useState<KeySelection | null>({
    kind: "symmetric",
    id: fakeKeys[0]!.id,
  })
  return (
    <>
      <SensitiveStateProbe />
      <KeyDetailDialog
        selection={selection}
        identity={undefined}
        previous={undefined}
        symmetric={selection === null ? undefined : fakeKeys[0]}
        onOpenChange={(open) => {
          if (!open) setSelection(null)
        }}
        onChanged={async () => undefined}
      />
    </>
  )
}

describe("key list page", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("defaults to owned keys, merges newest-first, and filters with one kind select", async () => {
    const user = userEvent.setup()
    await renderKeyList()

    expect(screen.getByRole("heading", { name: "Key list" })).toBeInTheDocument()
    const ownTab = screen.getByRole("tab", { name: "My keys" })
    const peerTab = screen.getByRole("tab", { name: "Other parties' keys" })
    expect(ownTab).toHaveAttribute("aria-selected", "true")
    expect(peerTab).toHaveAttribute("aria-selected", "false")
    expect(screen.getByRole("tablist")).toHaveClass(
      "grid",
      "h-11",
      "w-full",
      "grid-cols-2",
    )
    const kindFilter = screen.getByRole("combobox", { name: "Type" })
    expect(screen.getAllByRole("combobox")).toHaveLength(1)
    expect(kindFilter).toHaveClass("h-11")
    expect(kindFilter).toHaveTextContent("All")

    const rows = within(screen.getByRole("tabpanel")).getAllByRole("button")
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent("自分のPQ ID")
    expect(rows[1]).toHaveTextContent("共通鍵A")
    expect(screen.getByText("自分のPQ ID")).toBeInTheDocument()
    expect(screen.getByText(/Post-quantum identity ·/)).toBeInTheDocument()
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.getByText(/Symmetric key ·/)).toBeInTheDocument()
    // Both badges report lifecycle state, never key type.
    expect(within(rows[0]!).getByText("Active")).toBeInTheDocument()
    expect(within(rows[1]!).getByText("Active")).toBeInTheDocument()
    expect(within(screen.getByRole("tabpanel")).queryByText("AES-256-GCM")).toBeNull()
    expect(screen.queryByText("Public")).not.toBeInTheDocument()
    expect(screen.queryByText("Secret")).not.toBeInTheDocument()
    expect(screen.queryByText("受信鍵B")).not.toBeInTheDocument()
    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("3".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("1".repeat(64))).toBeInTheDocument()
    expect(within(dialog).getByText("2".repeat(64))).toBeInTheDocument()
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(kindFilter)
    expect(screen.getAllByRole("option").map((option) => option.textContent)).toEqual([
      "All",
      "Post-quantum identity",
      "Symmetric key",
    ])
    await user.click(screen.getByRole("option", { name: "Symmetric key" }))
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.queryByText("自分のPQ ID")).not.toBeInTheDocument()

    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    expect(within(dialog).getByText("sym-key-00000001")).toBeInTheDocument()
    expect(within(dialog).getByText("AES-256-GCM")).toBeInTheDocument()
    expect(
      within(dialog).getAllByRole("button", { name: "Close" }),
    ).toHaveLength(1)
    expect(Array.from(dialog.querySelectorAll("button")).at(-1)).toBe(
      within(dialog).getByRole("button", { name: "Close" }),
    )
    await user.keyboard("{Escape}")
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
  })

  it("shows imported bundles only on the peer-key tab and keeps their actions", async () => {
    const user = userEvent.setup()
    const recordId = fakeBundles[0]!.recordId
    await renderKeyList()

    expect(screen.queryByText("確認済みの相手")).not.toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Other parties' keys" }))
    expect(screen.getByText("確認済みの相手")).toBeInTheDocument()
    expect(screen.getByText("Identity verified")).toBeInTheDocument()
    expect(screen.getByText("4".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("5".repeat(64))).toBeInTheDocument()
    expect(screen.getByText("6".repeat(64))).toBeInTheDocument()
    expect(screen.queryByRole("combobox", { name: "Type" })).not.toBeInTheDocument()
    expect(
      screen.getByRole("button", { name: "Disable on this device" }),
    ).toBeInTheDocument()

    await user.click(screen.getByRole("button", { name: "Delete" }))
    await waitFor(() => expect(deleteBundle).toHaveBeenCalledWith(recordId))
    expect(
      await screen.findByText("There are no imported public-key bundles."),
    ).toBeInTheDocument()
  })

  it("shows QR views in the same dialog and never offers QR persistence", async () => {
    const user = userEvent.setup()
    const firstQrRender = deferred<string>()
    renderQrDataUrl.mockImplementationOnce(() => firstQrRender.promise)
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "Public-key bundle QR" }))
    dialog = await screen.findByRole("dialog", { name: /public-key bundle/ })
    expect(within(dialog).getByText(/OCF2 frames/)).toBeInTheDocument()
    expect(
      within(dialog).getByRole("button", { name: "Back to details" }),
    ).toBeInTheDocument()
    const bundleFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(bundleFullscreenTriggers).toHaveLength(1)
    const bundleFullscreen = bundleFullscreenTriggers[0]!
    expect(bundleFullscreen).toBeDisabled()
    await waitFor(() => expect(renderQrDataUrl).toHaveBeenCalled())
    expect(bundleFullscreen).toBeDisabled()
    firstQrRender.resolve("data:image/png;base64,ZmFrZQ==")
    await waitFor(() => expect(bundleFullscreen).toBeEnabled())
    expect(within(dialog).queryByText(/Saved/)).toBeNull()
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-public-identity",
        }),
      ),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")
    await user.click(bundleFullscreen)
    let fullscreen = await screen.findByRole("dialog", {
      name: /View .*public-key bundle.* full screen/,
    })
    await user.click(within(fullscreen).getByRole("button", { name: "Close" }))
    expect(screen.getByRole("dialog", { name: /public-key bundle/ })).toBeInTheDocument()

    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Encryption public-key QR" }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-kem-public-key",
        }),
      ),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")
    const kemFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(kemFullscreenTriggers).toHaveLength(1)
    await waitFor(() => expect(kemFullscreenTriggers[0]).toBeEnabled())
    await user.click(kemFullscreenTriggers[0]!)
    fullscreen = await screen.findByRole("dialog", {
      name: /View .*encryption public key.* full screen/,
    })
    await user.click(within(fullscreen).getByRole("button", { name: "Close" }))

    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(
      within(dialog).getByRole("button", {
        name: "Signature-verification public-key QR",
      }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-dsa-public-key",
        }),
      ),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")
    const signingFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(signingFullscreenTriggers).toHaveLength(1)
    await waitFor(() => expect(signingFullscreenTriggers[0]).toBeEnabled())
    await user.click(signingFullscreenTriggers[0]!)
    fullscreen = await screen.findByRole("dialog", {
      name: /View .*signature-verification public key.* full screen/,
    })
    await user.click(within(fullscreen).getByRole("button", { name: "Close" }))
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "Show secret-key QR" }))
    dialog = await screen.findByRole("dialog", { name: "Symmetric-key QR" })
    const symmetricFullscreenTriggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(symmetricFullscreenTriggers).toHaveLength(1)
    await waitFor(() => expect(symmetricFullscreenTriggers[0]).toBeEnabled())
    await user.click(symmetricFullscreenTriggers[0]!)
    fullscreen = await screen.findByRole("dialog", {
      name: /View Symmetric-key QR full screen/,
    })
    expect(within(fullscreen).getByText("Sensitive information")).toBeInTheDocument()
    expect(fullscreen.querySelector("svg.lucide-triangle-alert")).toHaveAttribute(
      "aria-hidden",
      "true",
    )
    expect(within(fullscreen).queryByRole("button", { name: "Download" })).toBeNull()
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "Symmetric-key QR" })).toBeInTheDocument()
    expect(within(dialog).getByText("Sensitive information")).toBeInTheDocument()
    const download = within(dialog).getByRole("button", { name: "Download" })
    const copy = within(dialog).getByRole("button", { name: "Copy" })
    expect(download).toBeDisabled()
    expect(copy).toBeDisabled()
    expect(within(dialog).queryByRole("button", { name: /SVG/i })).toBeNull()
    await user.click(
      within(dialog).getByRole("checkbox", { name: "I understand the risk" }),
    )
    expect(download).toBeEnabled()
    expect(copy).toBeEnabled()
    expect(within(dialog).queryByText(/Saved/)).toBeNull()
  })

  it("keeps identity fullscreen open while compatibility mode re-splits and restarts at frame one", async () => {
    const timeout = vi.spyOn(window, "setTimeout")
    const defaultSplitIntoFrames = splitIntoFrames.getMockImplementation()!
    const compatibleSplit =
      deferred<Awaited<ReturnType<typeof defaultSplitIntoFrames>>>()
    let compatibleArgs:
      | Parameters<typeof defaultSplitIntoFrames>[0]
      | undefined
    const user = userEvent.setup()
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    const dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(
      within(dialog).getByRole("button", { name: "Public-key bundle QR" }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-public-identity",
          frameBytes: 1_000,
        }),
      ),
    )
    await waitFor(() => expect(within(dialog).getByRole("img")).toBeInTheDocument())
    await user.click(within(dialog).getByRole("button", { name: "Pause" }))
    const fullscreenTrigger = within(dialog).getByRole("button", {
      name: "View full screen",
    })
    await waitFor(() => expect(fullscreenTrigger).toBeEnabled())
    await user.click(fullscreenTrigger)
    const fullscreen = await screen.findByRole("dialog", {
      name: /View .*public-key bundle.* full screen/,
    })
    if (within(fullscreen).queryByText("1 / 4")) {
      await user.click(within(fullscreen).getByRole("button", { name: "Next" }))
    }
    const stalePosition = within(fullscreen).getByText(/^[2-4] \/ 4$/).textContent
    const compatibility = within(fullscreen).getByRole("switch", {
      name: "Compatibility mode",
    })
    expect(compatibility).not.toBeChecked()
    splitIntoFrames.mockImplementationOnce((args) => {
      compatibleArgs = args
      return compatibleSplit.promise
    })
    await user.click(compatibility)

    await waitFor(() =>
      expect(updatePreferences).toHaveBeenCalledWith({
        frameBytes: 100,
        frameIntervalMs: 2_000,
      }),
    )
    await waitFor(() =>
      expect(splitIntoFrames).toHaveBeenLastCalledWith(
        expect.objectContaining({
          artifactType: "pq-public-identity",
          frameBytes: 100,
        }),
      ),
    )
    expect(
      screen.getByRole("dialog", {
        name: new RegExp(`View .*${stalePosition} full screen`),
      }),
    ).toBe(fullscreen)
    expect(within(fullscreen).getByRole("img")).toBeInTheDocument()

    const compatibleFrames = await defaultSplitIntoFrames(compatibleArgs!)
    const renderCallsBeforeResolve = renderQrDataUrl.mock.calls.length
    compatibleSplit.resolve(compatibleFrames)
    await compatibleSplit.promise

    await waitFor(() =>
      expect(
        within(fullscreen).getByText(`1 / ${compatibleFrames.length}`),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByRole("dialog", {
        name: new RegExp(
          `View .*public-key bundle.*1 / ${compatibleFrames.length} full screen`,
        ),
      }),
    ).toBe(fullscreen)
    await waitFor(() =>
      expect(renderQrDataUrl.mock.calls.length).toBeGreaterThan(
        renderCallsBeforeResolve,
      ),
    )
    expect(renderQrDataUrl.mock.calls[renderCallsBeforeResolve]?.[0]).toContain(
      `:0:${compatibleFrames.length}:pq-public-identity`,
    )
    expect(
      within(fullscreen).getAllByRole("button", { name: "Close" }),
    ).toHaveLength(1)
    await user.click(within(fullscreen).getByRole("button", { name: "Play" }))
    await waitFor(() =>
      expect(timeout.mock.calls.some(([, delay]) => delay === 2_000)).toBe(true),
    )
    await waitFor(() =>
      expect(
        within(fullscreen).getByRole("switch", { name: "Compatibility mode" }),
      ).toBeChecked(),
    )
  })

  it("keeps the fullscreen trigger disabled while identity frame splitting is pending", async () => {
    const user = userEvent.setup()
    splitIntoFrames.mockImplementationOnce(() => new Promise<never>(() => undefined))
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "Public-key bundle QR" }))
    dialog = await screen.findByRole("dialog", { name: /public-key bundle/ })
    await waitFor(() => expect(splitIntoFrames).toHaveBeenCalledOnce())

    const triggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toBeDisabled()
    await user.click(triggers[0]!)
    expect(dialog).not.toHaveAttribute("inert")
    expect(dialog).not.toHaveAttribute("aria-hidden", "true")
    expect(
      screen.queryByRole("dialog", { name: /full screen/ }),
    ).not.toBeInTheDocument()
  })

  it("keeps the fullscreen trigger disabled when identity frame splitting fails", async () => {
    const user = userEvent.setup()
    splitIntoFrames.mockRejectedValueOnce(new Error("split failed"))
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "Public-key bundle QR" }))
    dialog = await screen.findByRole("dialog", { name: /public-key bundle/ })
    await within(dialog).findByRole("alert")

    const triggers = within(dialog).getAllByRole("button", {
      name: "View full screen",
    })
    expect(triggers).toHaveLength(1)
    expect(triggers[0]).toBeDisabled()
    await user.click(triggers[0]!)
    expect(dialog).not.toHaveAttribute("inert")
    expect(dialog).not.toHaveAttribute("aria-hidden", "true")
    expect(
      screen.queryByRole("dialog", { name: /full screen/ }),
    ).not.toBeInTheDocument()
  })

  it("retains secretVisible across fullscreen close and clears it only with the detail dialog", async () => {
    const user = userEvent.setup()
    render(
      <LanguageProvider initialLanguage="en">
        <AppProviders features={fakeFeatures} pwaHook={undefined}>
          <SymmetricDetailHarness />
        </AppProviders>
      </LanguageProvider>,
    )
    expect(screen.getByTestId("secret-visible")).toHaveTextContent("false")
    let dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "Show secret-key QR" }))
    dialog = await screen.findByRole("dialog", { name: "Symmetric-key QR" })
    await waitFor(() =>
      expect(screen.getByTestId("secret-visible")).toHaveTextContent("true"),
    )
    await user.click(
      await within(dialog).findByRole("button", { name: "View full screen" }),
    )
    expect(screen.getByTestId("secret-visible")).toHaveTextContent("true")
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog", { name: "Symmetric-key QR" })).toBeInTheDocument()
    expect(screen.getByTestId("secret-visible")).toHaveTextContent("true")

    await user.click(within(dialog).getByRole("button", { name: "Close" }))
    await waitFor(() =>
      expect(screen.getByTestId("secret-visible")).toHaveTextContent("false"),
    )
  })

  it("retargets selection to the new head after rotate and re-derives after revoke", async () => {
    const user = userEvent.setup()
    const originalId = fakeIdentities[0]!.id
    await renderKeyList()
    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })

    await user.click(within(dialog).getByRole("button", { name: "Rotate" }))
    await waitFor(() => expect(saveRotation).toHaveBeenCalledOnce())
    expect(fakeIdentities[0]?.id).not.toBe(originalId)
    dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(
      within(dialog).getByRole("button", {
        name: /1 previous generations, decryption only/,
      }),
    ).toBeInTheDocument()

    const newId = fakeIdentities[0]!.id
    await user.click(
      within(dialog).getByRole("button", { name: "Revoke on this device" }),
    )
    await waitFor(() =>
      expect(revokeIdentity).toHaveBeenCalledWith(newId, expect.any(Number)),
    )
    dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("Revoked")).toBeInTheDocument()
    expect(
      within(dialog).queryByRole("button", { name: "Rotate" }),
    ).not.toBeInTheDocument()
  })

  it("closes automatically when the selected symmetric key is deleted", async () => {
    const user = userEvent.setup()
    await renderKeyList()
    await user.click(rowFor("共通鍵A"))
    const dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "Delete 共通鍵A" }))
    const confirmation = await screen.findByRole("alertdialog", {
      name: 'Delete "共通鍵A"?',
    })
    expectSingleAlertCancelWithoutClose(confirmation)
    await user.click(within(confirmation).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteKeyRecord).toHaveBeenCalledWith("sym-key-00000001"))
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "共通鍵A" })).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("共通鍵A")).not.toBeInTheDocument()
  })

  it("closes automatically when the selected identity is deleted", async () => {
    const user = userEvent.setup()
    const identityId = fakeIdentities[0]!.id
    await renderKeyList()
    await user.click(rowFor("自分のPQ ID"))
    const dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "Delete 自分のPQ ID" }))
    const confirmation = await screen.findByRole("alertdialog", {
      name: 'Delete "自分のPQ ID"?',
    })
    expectSingleAlertCancelWithoutClose(confirmation)
    await user.click(within(confirmation).getByRole("button", { name: "Delete" }))

    await waitFor(() => expect(deleteIdentity).toHaveBeenCalledWith(identityId))
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "自分のPQ ID" }),
      ).not.toBeInTheDocument(),
    )
    expect(screen.queryByText("自分のPQ ID")).not.toBeInTheDocument()
  })

  it("waits for both sources before showing the empty state", async () => {
    const user = userEvent.setup()
    fakeKeys.splice(0)
    fakeIdentities.splice(0)
    fakeBundles.splice(0)
    let resolveIdentities: ((value: typeof fakeIdentities) => void) | undefined
    listIdentities.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIdentities = resolve
        }),
    )
    await renderKeyList()
    expect(
      screen.queryByText("There are no keys. Create one on the keys page."),
    ).toBeNull()

    resolveIdentities?.([])
    expect(
      await screen.findByText("There are no keys. Create one on the keys page."),
    ).toBeInTheDocument()
    expect(screen.getByText("You have no keys.")).toBeInTheDocument()
    await user.click(screen.getByRole("tab", { name: "Other parties' keys" }))
    expect(
      screen.getByText("There are no imported public-key bundles."),
    ).toBeInTheDocument()
    expect(screen.getByRole("link", { name: "Open the keys page" })).toHaveAttribute(
      "href",
      "/keys",
    )
  })

  it("shows one source error while continuing to render the other source", async () => {
    listIdentities.mockRejectedValueOnce(new Error("identity read failed"))
    await renderKeyList()
    expect(
      await screen.findByText("Post-quantum identities could not be loaded"),
    ).toBeInTheDocument()
    expect(await screen.findByText("共通鍵A")).toBeInTheDocument()

    resetUi()
    listKeyRecords.mockRejectedValueOnce(new Error("key read failed"))
    await renderKeyList()
    expect(
      await screen.findByText("Symmetric keys could not be loaded"),
    ).toBeInTheDocument()
    expect(screen.getByText("自分のPQ ID")).toBeInTheDocument()
  })

  it("labels unsupported profiles and restricts them to deletion", async () => {
    const user = userEvent.setup()
    fakeIdentities[0] = { ...fakeIdentities[0]!, profile: "balanced" }
    await renderKeyList()
    expect(await screen.findByText("Unsupported (legacy profile)")).toBeInTheDocument()
    await user.click(rowFor("自分のPQ ID"))
    const dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(
      within(dialog).getByText(
        /cryptographic operations and QR re-export are unavailable/,
      ),
    ).toBeInTheDocument()
    expect(
      within(dialog).queryByRole("button", { name: "Public-key bundle QR" }),
    ).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "Rotate" })).toBeNull()
    expect(
      within(dialog).queryByRole("button", { name: "Revoke on this device" }),
    ).toBeNull()
    expect(
      within(dialog).getByRole("button", { name: "Delete 自分のPQ ID" }),
    ).toBeInTheDocument()
  })
})
