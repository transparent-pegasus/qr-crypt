import "./helpers/module-mocks"
import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  deleteBundle,
  deleteIdentity,
  deleteKeyRecord,
  fakeBundles,
  fakeIdentities,
  fakeKeys,
  listIdentities,
  listKeyRecords,
  revokeIdentity,
  saveRotation,
  splitIntoFrames,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

function rowFor(text: string): HTMLButtonElement {
  const row = screen.getByText(text).closest("button")
  if (!(row instanceof HTMLButtonElement)) throw new Error(`row not found: ${text}`)
  return row
}

async function renderKeyList(): Promise<void> {
  await renderApp("/saved")
  await screen.findByRole("heading", { name: "Key list" })
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
    expect(screen.getByText("active")).toBeInTheDocument()
    expect(screen.getByText("共通鍵A")).toBeInTheDocument()
    expect(screen.getByText(/Symmetric key ·/)).toBeInTheDocument()
    expect(screen.getByText("AES-256-GCM")).toBeInTheDocument()
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
    await renderKeyList()

    await user.click(rowFor("自分のPQ ID"))
    let dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    await user.click(within(dialog).getByRole("button", { name: "Public-key bundle QR" }))
    dialog = await screen.findByRole("dialog", { name: /public-key bundle/ })
    expect(within(dialog).getByText(/OCF2 frames/)).toBeInTheDocument()
    expect(within(dialog).getByRole("button", { name: "Back to details" })).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "View full screen" })).toBeNull()
    expect(within(dialog).queryByText(/Saved/)).toBeNull()
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-public-identity",
        frameCount: 20,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameBytes")

    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(within(dialog).getByRole("button", { name: "Encryption public-key QR" }))
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-kem-public-key",
        frameBytes: 280,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")

    await user.click(within(dialog).getByRole("button", { name: "Back to details" }))
    await user.click(
      within(dialog).getByRole("button", { name: "Signature-verification public-key QR" }),
    )
    expect(splitIntoFrames).toHaveBeenLastCalledWith(
      expect.objectContaining({
        artifactType: "pq-dsa-public-key",
        frameBytes: 280,
      }),
    )
    expect(splitIntoFrames.mock.calls.at(-1)?.[0]).not.toHaveProperty("frameCount")
    await user.click(within(dialog).getByRole("button", { name: "Close" }))

    await user.click(rowFor("共通鍵A"))
    dialog = await screen.findByRole("dialog", { name: "共通鍵A" })
    await user.click(within(dialog).getByRole("button", { name: "Show secret-key QR" }))
    dialog = await screen.findByRole("dialog", { name: "Symmetric-key QR" })
    const png = within(dialog).getByRole("button", { name: "PNG" })
    const svg = within(dialog).getByRole("button", { name: "SVG" })
    const copy = within(dialog).getByRole("button", { name: "Copy" })
    expect(png).toBeDisabled()
    expect(svg).toBeDisabled()
    expect(copy).toBeDisabled()
    await user.click(
      within(dialog).getByRole("checkbox", { name: "I understand the risk" }),
    )
    expect(png).toBeEnabled()
    expect(svg).toBeEnabled()
    expect(copy).toBeEnabled()
    expect(within(dialog).queryByText(/Saved/)).toBeNull()
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
    await user.click(within(dialog).getByRole("button", { name: "Revoke on this device" }))
    await waitFor(() =>
      expect(revokeIdentity).toHaveBeenCalledWith(newId, expect.any(Number)),
    )
    dialog = await screen.findByRole("dialog", { name: "自分のPQ ID" })
    expect(within(dialog).getByText("revoked")).toBeInTheDocument()
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
    expect(await screen.findByText("Symmetric keys could not be loaded")).toBeInTheDocument()
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
      within(dialog).getByText(/cryptographic operations and QR re-export are unavailable/),
    ).toBeInTheDocument()
    expect(within(dialog).queryByRole("button", { name: "Public-key bundle QR" })).toBeNull()
    expect(within(dialog).queryByRole("button", { name: "Rotate" })).toBeNull()
    expect(
      within(dialog).queryByRole("button", { name: "Revoke on this device" }),
    ).toBeNull()
    expect(
      within(dialog).getByRole("button", { name: "Delete 自分のPQ ID" }),
    ).toBeInTheDocument()
  })
})
