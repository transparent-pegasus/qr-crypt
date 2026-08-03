import { beforeEach, describe, expect, it, vi } from "vitest"
import { acquireRelayLease, withSensitiveWriteLock } from "@/storage/database"
import { installWebLocksStub } from "../helpers/web-locks"

describe("relay lease", () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    vi.stubGlobal("navigator", {})
    installWebLocksStub()
  })

  it("holds the sensitive-write lock until released", async () => {
    const lease = await acquireRelayLease()
    expect(lease).not.toBeNull()

    const order: string[] = []
    const write = withSensitiveWriteLock(async () => {
      order.push("write")
    })
    await Promise.resolve()
    expect(order).toEqual([])

    order.push("release")
    lease!.release()
    await write
    expect(order).toEqual(["release", "write"])
  })

  it("returns null instead of queueing when the lock is already held", async () => {
    const first = await acquireRelayLease()
    expect(first).not.toBeNull()
    expect(await acquireRelayLease()).toBeNull()
    first!.release()
  })

  // The fail-closed direction: a writer already inside the lock denies the
  // session rather than making the operator wait behind it.
  it("returns null while a shared writer holds the lock", async () => {
    let finishWrite = (): void => {}
    const write = withSensitiveWriteLock(
      () =>
        new Promise<void>((resolve) => {
          finishWrite = resolve
        }),
    )
    await Promise.resolve()
    expect(await acquireRelayLease()).toBeNull()
    finishWrite()
    await write
  })

  it("returns null when the platform has no Web Locks", async () => {
    vi.stubGlobal("navigator", {})
    expect(await acquireRelayLease()).toBeNull()
  })

  // Releasing is asynchronous — the lock is held until the request callback's
  // promise settles — so the next session becomes possible on a later turn, not
  // in the same one. Every real re-acquire path awaits an eligibility refresh
  // first, so this is the honest shape to pin.
  it("frees the lock once released, and tolerates a second release", async () => {
    const lease = await acquireRelayLease()
    lease!.release()
    lease!.release()
    await new Promise((resolve) => setTimeout(resolve, 0))

    const next = await acquireRelayLease()
    expect(next).not.toBeNull()
    next!.release()
  })
})
