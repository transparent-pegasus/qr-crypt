import "./helpers/module-mocks"
import { act, screen, waitFor } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { deferred } from "../helpers/deferred"
import {
  createIdentity,
  createSymmetricKeyRecord,
  saveIdentity,
  saveKeyRecord,
} from "./helpers/fakes"
import { renderApp, resetUi } from "./helpers/render-app"

// resetFakes leaves defaultAlgorithm at A256GCM, so the create view opens on the
// symmetric kind; only the identity case has to touch the Key type select.
async function openCreateForm(user: UserEvent): Promise<HTMLElement> {
  await renderApp("/keys")
  await user.click(await screen.findByRole("button", { name: "Create a key" }))
  return screen.findByLabelText("Shared-key name")
}

// A resumed continuation crosses several microtask hops before it reaches its
// write, so a negative assertion needs a macrotask boundary to be worth anything.
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
}

describe("KeyAddDialog abandonment", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it("does not persist a key when the modal is closed mid-generation", async () => {
    const generation = deferred<Awaited<ReturnType<typeof createSymmetricKeyRecord>>>()
    const real = createSymmetricKeyRecord.getMockImplementation()!
    createSymmetricKeyRecord.mockReturnValueOnce(generation.promise)
    const user = userEvent.setup()

    await user.type(await openCreateForm(user), "abandoned")
    await user.click(screen.getByRole("button", { name: "Create a shared key" }))
    await waitFor(() => expect(createSymmetricKeyRecord).toHaveBeenCalledOnce())

    // Generation is the cancellable part, so dismissal must work here.
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    generation.resolve(await real("abandoned", Date.now()))
    await settle()
    expect(saveKeyRecord).not.toHaveBeenCalled()
  })

  it("refuses to dismiss while the key write is pending", async () => {
    const write = deferred<void>()
    const real = saveKeyRecord.getMockImplementation()!
    saveKeyRecord.mockImplementationOnce(async (record) => {
      // Raw dispatch, unwrapped by act, so this lands in the gap between the
      // synchronous ref assignment and the render that setPersisting scheduled.
      // Only persistingRef covers that gap; the mirrored state has not painted.
      document.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      )
      await write.promise
      await real(record)
    })
    const user = userEvent.setup()

    await user.type(await openCreateForm(user), "committing")
    await user.click(screen.getByRole("button", { name: "Create a shared key" }))
    await waitFor(() => expect(saveKeyRecord).toHaveBeenCalledOnce())
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    // And again once the write has painted, which is the mirrored flag's job.
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument()

    // The refusal is a delay, not a cancellation: the creation still completes.
    write.resolve()
    expect(await screen.findByRole("dialog", { name: "committing" })).toBeInTheDocument()
  })

  it("allows dismissal again once a failed write settles", async () => {
    const write = deferred<void>()
    saveKeyRecord.mockReturnValueOnce(write.promise)
    const user = userEvent.setup()

    await user.type(await openCreateForm(user), "rejected")
    await user.click(screen.getByRole("button", { name: "Create a shared key" }))
    await waitFor(() => expect(saveKeyRecord).toHaveBeenCalledOnce())

    write.reject(new Error("write failed"))
    await screen.findByRole("alert")

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
  })

  it("does not persist an identity when the modal is closed mid-generation", async () => {
    const generation = deferred<Awaited<ReturnType<typeof createIdentity>>>()
    const real = createIdentity.getMockImplementation()!
    createIdentity.mockReturnValueOnce(generation.promise)
    const user = userEvent.setup()

    await openCreateForm(user)
    await user.click(screen.getByRole("combobox", { name: "Key type" }))
    await user.click(
      screen.getByRole("option", {
        name: "Post-quantum identity ML-KEM-1024 + ML-DSA-87",
      }),
    )
    await user.type(
      await screen.findByLabelText("Post-quantum identity name"),
      "abandoned id",
    )
    await user.click(
      screen.getByRole("button", { name: "Create a post-quantum identity" }),
    )
    await waitFor(() => expect(createIdentity).toHaveBeenCalledOnce())

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    generation.resolve(await real({ name: "abandoned id", now: Date.now() }))
    await settle()
    expect(saveIdentity).not.toHaveBeenCalled()
  })
})
