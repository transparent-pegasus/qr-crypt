import { accessSync, chmodSync, constants, copyFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { beforeAll, describe, expect, it } from "vitest"
import { createFixture, REPO_ROOT, run, writeFiles } from "../fixtures/release-fixture"

// Synthetic versions exercise comparison policy; these are not maintained pins.
const PIN = "1.2.3"
const checker = path.join(REPO_ROOT, "scripts/check-crypto-release.sh")
const latest = (tag: unknown = `v${PIN}`) =>
  JSON.stringify({ tag_name: tag, draft: false, prerelease: false })

function checkerFixture({ pin = PIN, response = latest(), status = "0" } = {}) {
  const fixture = createFixture()
  const bin = path.join(fixture.directory, "bin")
  writeFiles(fixture.directory, {
    "repo/package.json": JSON.stringify({
      dependencies: { "@noble/post-quantum": pin },
    }),
    "response.json": response,
    "gh-calls.jsonl": "",
    "bin/curl": "#!/bin/sh\nexit 97\n",
    "bin/wget": "#!/bin/sh\nexit 97\n",
  })
  copyFileSync(
    path.join(REPO_ROOT, "tests/fixtures/crypto-release-gh.py"),
    path.join(bin, "gh"),
  )
  for (const name of ["gh", "curl", "wget"]) chmodSync(path.join(bin, name), 0o755)
  const calls = path.join(fixture.directory, "gh-calls.jsonl")
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GH_HOST: "github.com",
    GH_CONFIG_DIR: path.join(fixture.directory, "gh-config"),
    CRYPTO_TEST_GH_RESPONSE: path.join(fixture.directory, "response.json"),
    CRYPTO_TEST_GH_CALLS: calls,
    CRYPTO_TEST_GH_STATUS: status,
  }
  return {
    ...fixture,
    env,
    calls: () => readFileSync(calls, "utf8"),
    execute: () => run(fixture.root, checker, [], env),
  }
}

describe("offline gh fixture", () => {
  it.each([[], ["--jq", ".tag_name"], ["-q", ".tag_name"]])(
    "emulates gh field extraction %j",
    (...extraction) => {
      const fixture = checkerFixture()
      const outcome = run(
        fixture.root,
        "gh",
        ["api", "repos/paulmillr/noble-post-quantum/releases/latest", ...extraction],
        fixture.env,
      )
      expect(outcome.status, outcome.stderr).toBe(0)
      expect(outcome.stdout.trim()).toBe(extraction.length === 0 ? latest() : `v${PIN}`)
    },
  )
})

describe("external crypto release checker", () => {
  beforeAll(() => accessSync(checker, constants.X_OK))

  it("succeeds when the exact cwd pin matches the official latest stable release", () => {
    const fixture = checkerFixture()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)
    expect(fixture.calls()).toContain("paulmillr/noble-post-quantum/releases/latest")
  })

  it.each(["v1.2.4", "v1.3.0", "v2.0.0", "v1.2.2"])(
    "fails visibly when the official release %s differs from the exact pin",
    (tag) => {
      const fixture = checkerFixture({ response: latest(tag) })
      const outcome = fixture.execute()
      expect(outcome.status).not.toBe(0)
      expect(fixture.calls()).not.toBe("")
      expect(`${outcome.stdout}${outcome.stderr}`.trim()).not.toBe("")
    },
  )

  it.each([
    ["malformed JSON", "{broken"],
    ["empty output", ""],
    ["null response", "null"],
    ["missing tag", JSON.stringify({ draft: false, prerelease: false })],
    ["null tag", latest(null)],
    ["empty tag", latest("")],
    ["non-string tag", latest(123)],
    ["invalid version tag", latest("not-a-version")],
    [
      "draft release",
      JSON.stringify({ tag_name: `v${PIN}`, draft: true, prerelease: false }),
    ],
    [
      "prerelease",
      JSON.stringify({ tag_name: `v${PIN}`, draft: false, prerelease: true }),
    ],
  ])("fails closed on %s", (_name, response) => {
    const outcome = checkerFixture({ response }).execute()
    expect(outcome.status).not.toBe(0)
  })

  it("fails when gh cannot reach GitHub, even if a matching fixture body is available", () => {
    const fixture = checkerFixture({ status: "23" })
    const outcome = fixture.execute()
    expect(outcome.status).not.toBe(0)
    expect(fixture.calls()).not.toBe("")
  })

  it.each(["^1.2.3", "~1.2.3", ">=1.2.3", "1.2.x", "*", "latest", "", "file:../pq"])(
    "rejects the non-exact local pin %j",
    (pin) => {
      const outcome = checkerFixture({ pin }).execute()
      expect(outcome.status).not.toBe(0)
    },
  )

  it.each([{}, { dependencies: {} }, { dependencies: { "@noble/post-quantum": null } }])(
    "rejects a missing or non-string local pin in %j",
    (manifest) => {
      const fixture = checkerFixture()
      writeFiles(fixture.root, { "package.json": JSON.stringify(manifest) })
      expect(fixture.execute().status).not.toBe(0)
    },
  )
})
