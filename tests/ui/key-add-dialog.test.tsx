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
import { type ReactNode } from "react"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent, { type UserEvent } from "@testing-library/user-event"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { KeyAddDialog } from "@/components/key-add-dialog"
import { LanguageProvider } from "@/i18n"
import { deferred } from "../helpers/deferred"
import { fakeFeatures } from "./helpers/fakes/feature-detection"
import { createSymmetricKeyRecord } from "./helpers/fakes/symmetric-crypto"
import { createIdentity } from "./helpers/fakes/pq-crypto"
import { saveKeyRecord } from "./helpers/fakes/key-records"
import { saveIdentity } from "./helpers/fakes/pq-records"
import { renderApp, resetUi } from "./helpers/render-app"

// resetFakes leaves defaultAlgorithm at A256GCM, so the create view opens on the
// symmetric kind; only the identity case has to touch the Key type select.
async function openCreateForm(user: UserEvent): Promise<HTMLElement> {
  await renderApp("/keys")
  await user.click(await screen.findByRole("button", { name: "Create a key" }))
  return screen.findByLabelText("Shared-key name")
}

async function selectIdentityForm(user: UserEvent): Promise<HTMLElement> {
  await user.click(screen.getByRole("combobox", { name: "Key type" }))
  await user.click(
    screen.getByRole("option", { name: "Public key ML-KEM-1024 + ML-DSA-87" }),
  )
  return screen.findByLabelText("Public-key name")
}

function DialogProviders({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider initialLanguage="en">
      <AppProviders features={fakeFeatures} pwaHook={undefined}>
        {children}
      </AppProviders>
    </LanguageProvider>
  )
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

    // "again" is the whole claim, so the gate has to be observed shut first:
    // without this the case passes on a dialog that was never locked at all.
    await user.keyboard("{Escape}")
    expect(screen.getByRole("dialog")).toBeInTheDocument()

    write.reject(new Error("write failed"))
    await screen.findByRole("alert")

    // The release is in a finally: a write that rejects must not strand the user
    // in a modal that refuses every dismiss path.
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
        name: "Public key ML-KEM-1024 + ML-DSA-87",
      }),
    )
    await user.type(await screen.findByLabelText("Public-key name"), "abandoned id")
    await user.click(screen.getByRole("button", { name: "Create a public key" }))
    await waitFor(() => expect(createIdentity).toHaveBeenCalledOnce())

    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())

    generation.resolve(await real({ name: "abandoned id", now: Date.now() }))
    await settle()
    expect(saveIdentity).not.toHaveBeenCalled()
  })

  it.each(["success", "rejection"] as const)(
    "blocks identity write dismissal before and after paint until $0",
    async (outcome) => {
      const write = deferred<void>()
      const real = saveIdentity.getMockImplementation()!
      saveIdentity.mockImplementationOnce(async (identity) => {
        // Dispatch inside the writer, before React can paint the pending state.
        document.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        )
        await write.promise
        await real(identity)
      })
      const user = userEvent.setup()

      await openCreateForm(user)
      await user.type(await selectIdentityForm(user), "committing identity")
      await user.click(screen.getByRole("button", { name: "Create a public key" }))
      await waitFor(() => expect(saveIdentity).toHaveBeenCalledOnce())
      expect(screen.getByRole("dialog", { name: "Create" })).toBeInTheDocument()

      await user.keyboard("{Escape}")
      expect(screen.getByRole("dialog", { name: "Create" })).toBeInTheDocument()
      expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument()

      if (outcome === "success") {
        write.resolve()
        expect(
          await screen.findByRole("dialog", { name: "committing identity" }),
        ).toBeInTheDocument()
      } else {
        write.reject(new Error("identity write failed"))
        await screen.findByRole("alert")
        await user.click(screen.getByRole("button", { name: "Close" }))
        await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
      }
    },
  )
})

describe("KeyAddDialog parent-controlled sessions", () => {
  beforeEach(resetUi)
  afterEach(resetUi)

  it.each([
    { mode: "create", field: "Shared-key name", submit: "Create a shared key" },
    { mode: "import", field: "Key payload", submit: "Read the key" },
  ] as const)(
    "clears $mode fields and errors when reopened in the same mode",
    async ({ mode, field, submit }) => {
      if (mode === "create") {
        createSymmetricKeyRecord.mockRejectedValueOnce(new Error("generation failed"))
      }
      const callbacks = {
        onOpenChange: vi.fn(),
        onCreated: vi.fn(async () => undefined),
        onImported: vi.fn(async () => undefined),
      }
      const rendered = render(<KeyAddDialog mode={mode} detail={null} {...callbacks} />, {
        wrapper: DialogProviders,
      })
      const user = userEvent.setup()

      await user.type(await screen.findByLabelText(field), "previous input")
      await user.click(screen.getByRole("button", { name: submit }))
      await screen.findByRole("alert")
      expect(screen.getByLabelText(field)).toHaveValue("previous input")

      rendered.rerender(<KeyAddDialog mode={null} detail={null} {...callbacks} />)
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
      rendered.rerender(<KeyAddDialog mode={mode} detail={null} {...callbacks} />)

      expect(screen.getByLabelText(field)).toHaveValue("")
      expect(screen.queryByRole("alert")).not.toBeInTheDocument()
      expect(screen.getByRole("button", { name: submit })).toBeDisabled()
    },
  )

  describe.each(["symmetric", "identity"] as const)("%s creation", (kind) => {
    it.each([
      { nextMode: "import", pending: "generation", outcome: "success" },
      { nextMode: null, pending: "generation", outcome: "success" },
      { nextMode: null, pending: "generation", outcome: "rejection" },
      { nextMode: null, pending: "write", outcome: "success" },
      { nextMode: null, pending: "write", outcome: "rejection" },
    ] as const)(
      "suppresses stale $pending $outcome after the parent sets mode=$nextMode",
      async ({ nextMode, pending, outcome }) => {
        const operation = deferred<void>()
        if (pending === "generation") {
          if (kind === "symmetric") {
            const generate = createSymmetricKeyRecord.getMockImplementation()!
            createSymmetricKeyRecord.mockImplementationOnce(async (name, now) => {
              await operation.promise
              return generate(name, now)
            })
          } else {
            const generate = createIdentity.getMockImplementation()!
            createIdentity.mockImplementationOnce(async (args) => {
              await operation.promise
              return generate(args)
            })
          }
        } else if (kind === "symmetric") {
          const save = saveKeyRecord.getMockImplementation()!
          saveKeyRecord.mockImplementationOnce(async (record) => {
            await operation.promise
            await save(record)
          })
        } else {
          const save = saveIdentity.getMockImplementation()!
          saveIdentity.mockImplementationOnce(async (identity) => {
            await operation.promise
            await save(identity)
          })
        }
        const callbacks = {
          onOpenChange: vi.fn(),
          onCreated: vi.fn(async () => undefined),
          onImported: vi.fn(async () => undefined),
        }
        const rendered = render(
          <KeyAddDialog mode="create" detail={null} {...callbacks} />,
          { wrapper: DialogProviders },
        )
        const user = userEvent.setup()
        const field =
          kind === "identity"
            ? await selectIdentityForm(user)
            : await screen.findByLabelText("Shared-key name")
        await user.type(field, "previous opening")
        await user.click(
          screen.getByRole("button", {
            name: kind === "identity" ? "Create a public key" : "Create a shared key",
          }),
        )
        const generate = kind === "identity" ? createIdentity : createSymmetricKeyRecord
        const save = kind === "identity" ? saveIdentity : saveKeyRecord
        await waitFor(() =>
          expect(pending === "generation" ? generate : save).toHaveBeenCalledOnce(),
        )

        rendered.rerender(<KeyAddDialog mode={nextMode} detail={null} {...callbacks} />)
        if (nextMode === null) {
          expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
          // Reopen before settlement so stale errors would be visible to the user.
          rendered.rerender(<KeyAddDialog mode="create" detail={null} {...callbacks} />)
        }
        const currentField = nextMode === "import" ? "Key payload" : "Shared-key name"
        await user.type(screen.getByLabelText(currentField), "current opening")

        if (outcome === "success") operation.resolve()
        else operation.reject(new Error("abandoned operation failed"))
        await settle()

        expect(callbacks.onCreated).not.toHaveBeenCalled()
        expect(callbacks.onOpenChange).not.toHaveBeenCalled()
        expect(
          screen.getByRole("dialog", {
            name: nextMode === "import" ? "Import" : "Create",
          }),
        ).toBeInTheDocument()
        expect(screen.getByLabelText(currentField)).toHaveValue("current opening")
        expect(screen.queryByRole("alert")).not.toBeInTheDocument()
        if (pending === "generation") expect(save).not.toHaveBeenCalled()
        else expect(save).toHaveBeenCalledOnce()
      },
    )
  })
})
