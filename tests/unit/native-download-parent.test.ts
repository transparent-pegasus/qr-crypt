import { describe, expect, it } from "vitest"
import { createOwnedDownloadParent } from "../e2e-native-relay/download-io"

describe("createOwnedDownloadParent", () => {
  it("synchronously checks, creates, retains the exact path once, then checks again", () => {
    const events: string[] = []

    const result = createOwnedDownloadParent(
      () => {
        events.push("create")
        return "/synthetic-temp/Owned Parent-123"
      },
      (parent) => {
        events.push(`retain:${parent}`)
      },
      () => {
        events.push("check")
      },
    )

    expect(result).toBeUndefined()
    expect(events).toEqual([
      "check",
      "create",
      "retain:/synthetic-temp/Owned Parent-123",
      "check",
    ])
  })

  it("propagates the initial deadline error without creating or retaining", () => {
    const events: string[] = []
    const failure = new Error("deadline already expired")
    let caught: unknown

    try {
      createOwnedDownloadParent(
        () => {
          events.push("create")
          return "/synthetic-temp/Owned Parent-123"
        },
        () => {
          events.push("retain")
        },
        () => {
          events.push("check")
          throw failure
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(failure)
    expect(events).toEqual(["check"])
  })

  it("propagates creation failure without retaining or checking again", () => {
    const events: string[] = []
    const failure = new Error("creation failed")
    let caught: unknown

    try {
      createOwnedDownloadParent(
        () => {
          events.push("create")
          throw failure
        },
        () => {
          events.push("retain")
        },
        () => {
          events.push("check")
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(failure)
    expect(events).toEqual(["check", "create"])
  })

  it("retains the exact late-created path before the deadline error escapes", () => {
    const events: string[] = []
    const retained: string[] = []
    const failure = new Error("creation crossed the deadline")
    let checks = 0
    let caught: unknown

    try {
      createOwnedDownloadParent(
        () => {
          events.push("create")
          return "/synthetic-temp/Owned Parent-123"
        },
        (parent) => {
          events.push("retain")
          retained.push(parent)
        },
        () => {
          events.push("check")
          checks += 1
          if (checks === 2) throw failure
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(failure)
    expect(retained).toEqual(["/synthetic-temp/Owned Parent-123"])
    expect(events).toEqual(["check", "create", "retain", "check"])
  })

  it("propagates retention failure without checking again", () => {
    const events: string[] = []
    const failure = new Error("retention failed")
    let caught: unknown

    try {
      createOwnedDownloadParent(
        () => {
          events.push("create")
          return "/synthetic-temp/Owned Parent-123"
        },
        (parent) => {
          events.push(`retain:${parent}`)
          throw failure
        },
        () => {
          events.push("check")
        },
      )
    } catch (error) {
      caught = error
    }

    expect(caught).toBe(failure)
    expect(events).toEqual(["check", "create", "retain:/synthetic-temp/Owned Parent-123"])
  })
})
