import { describe, expect, it } from "vitest"
import { ARCHIVE_NAME } from "../fixtures/release-publication"
import { signingFixture } from "../fixtures/release-signing"

describe("inline release signing", () => {
  it("signs and verifies when packaged and tested digests both identify the actual ZIP", () => {
    const fixture = signingFixture()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)
    expect(outcome.calls.map((args) => args.slice(0, 2))).toEqual([
      ["sign-blob", ARCHIVE_NAME],
      ["verify-blob", ARCHIVE_NAME],
    ])
  })

  it.each([
    { name: "packaged", env: { PACKAGED_ARCHIVE_SHA256: "0".repeat(64) } },
    { name: "tested", env: { TESTED_ARCHIVE_SHA256: "0".repeat(64) } },
    {
      name: "both",
      env: {
        PACKAGED_ARCHIVE_SHA256: "0".repeat(64),
        TESTED_ARCHIVE_SHA256: "0".repeat(64),
      },
    },
  ])("refuses a mismatching $name digest before invoking Cosign", ({ env }) => {
    const outcome = signingFixture().execute(env)
    expect(outcome.status, outcome.stderr).not.toBe(0)
    expect(outcome.calls).toEqual([])
  })

  describe.each(["PACKAGED_ARCHIVE_SHA256", "TESTED_ARCHIVE_SHA256"])(
    "%s validation",
    (name) => {
      it("rejects the actual ZIP digest in uppercase before invoking Cosign", () => {
        const fixture = signingFixture()
        const outcome = fixture.execute({ [name]: fixture.digest.toUpperCase() })
        expect(outcome.status, outcome.stderr).not.toBe(0)
        expect(outcome.calls).toEqual([])
      })

      it.each([
        undefined,
        "",
        "A".repeat(64),
        "a".repeat(63),
        "g".repeat(64),
        `${"a".repeat(64)}\n`,
      ])("rejects missing or noncanonical digest %j before invoking Cosign", (value) => {
        const outcome = signingFixture().execute({ [name]: value })
        expect(outcome.status, outcome.stderr).not.toBe(0)
        expect(outcome.calls).toEqual([])
      })
    },
  )
})
