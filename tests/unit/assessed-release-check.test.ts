import { accessSync, chmodSync, constants, copyFileSync, readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { createFixture, REPO_ROOT, run, writeFiles } from "../fixtures/release-fixture"

// Synthetic versions exercise comparison policy; these are not maintained pins.
const assessed = [
  {
    name: "@noble/post-quantum",
    pin: "1.2.3",
    endpoint: "repos/paulmillr/noble-post-quantum/releases/latest",
  },
  {
    name: "zxing-wasm",
    pin: "4.5.6",
    endpoint: "repos/Sec-ant/zxing-wasm/releases/latest",
  },
] as const
const checker = path.join(REPO_ROOT, "scripts/check-assessed-releases.sh")
const latest = (tag: unknown) =>
  JSON.stringify({ tag_name: tag, draft: false, prerelease: false })

function checkerFixture(
  name = assessed[0].name as string,
  options: { response?: string; status?: number; pin?: unknown } = {},
) {
  const fixture = createFixture()
  const bin = path.join(fixture.directory, "bin")
  writeFiles(fixture.directory, {
    "repo/package.json": JSON.stringify({
      dependencies: Object.fromEntries(
        assessed.map((item) => [
          item.name,
          item.name === name && "pin" in options ? options.pin : item.pin,
        ]),
      ),
    }),
    "scenario.json": JSON.stringify(
      Object.fromEntries(
        assessed.map((item) => [
          item.endpoint,
          {
            body:
              item.name === name && options.response !== undefined
                ? options.response
                : latest(`v${item.pin}`),
            status: item.name === name ? (options.status ?? 0) : 0,
          },
        ]),
      ),
    ),
    "gh-calls.jsonl": "",
    "bin/curl": "#!/bin/sh\nexit 97\n",
    "bin/wget": "#!/bin/sh\nexit 97\n",
  })
  copyFileSync(
    new URL("../fixtures/assessed-release-gh.py", import.meta.url),
    path.join(bin, "gh"),
  )
  for (const command of ["gh", "curl", "wget"]) chmodSync(path.join(bin, command), 0o755)
  const calls = path.join(fixture.directory, "gh-calls.jsonl")
  const env = {
    PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    GH_HOST: "github.com",
    GH_CONFIG_DIR: path.join(fixture.directory, "gh-config"),
    ASSESSED_RELEASE_TEST_SCENARIO: path.join(fixture.directory, "scenario.json"),
    ASSESSED_RELEASE_TEST_CALLS: calls,
  }
  return {
    ...fixture,
    env,
    calls: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]),
    execute: () => run(fixture.root, "bash", [checker], env),
  }
}

describe.each(assessed)(
  "offline official release fixture ($name)",
  ({ name, pin, endpoint }) => {
    it.each([[], ["--jq", ".tag_name"], ["-q", ".tag_name"]])(
      "honors gh field extraction %j",
      (...extraction) => {
        const fixture = checkerFixture(name)
        const outcome = run(
          fixture.root,
          "gh",
          ["api", endpoint, ...extraction],
          fixture.env,
        )
        expect(outcome.status, outcome.stderr).toBe(0)
        expect(outcome.stdout.trim()).toBe(
          extraction.length === 0 ? latest(`v${pin}`) : `v${pin}`,
        )
      },
    )
  },
)

describe("assessed release monitoring", () => {
  it("provides an executable CLI", () => {
    expect(() => accessSync(checker, constants.X_OK)).not.toThrow()
  })

  it("succeeds only after both exact cwd pins match their official latest stable releases", () => {
    const fixture = checkerFixture()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)
    for (const { endpoint } of assessed) {
      expect(
        fixture.calls().some((args) => args.some((arg) => arg.endsWith(endpoint))),
      ).toBe(true)
    }
  })

  it.each(["{broken", "null", "[]"])("rejects the malformed manifest %j", (manifest) => {
    const fixture = checkerFixture()
    writeFiles(fixture.root, { "package.json": manifest })
    expect(fixture.execute().status).not.toBe(0)
  })
})

describe.each(assessed)(
  "assessed release monitoring ($name)",
  ({ name, pin, endpoint }) => {
    it("accepts an official stable tag without the optional v prefix", () => {
      const outcome = checkerFixture(name, { response: latest(pin) }).execute()
      expect(outcome.status, outcome.stderr).toBe(0)
    })

    it.each(["0.0.1", "99.0.0"])(
      "refuses upstream version %s even when the other package matches",
      (version) => {
        const fixture = checkerFixture(name, { response: latest(`v${version}`) })
        const outcome = fixture.execute()
        expect(outcome.status).not.toBe(0)
        expect(
          fixture.calls().some((args) => args.some((arg) => arg.endsWith(endpoint))),
        ).toBe(true)
        expect(`${outcome.stdout}${outcome.stderr}`.trim()).not.toBe("")
      },
    )

    it.each([
      ["malformed JSON", "{broken"],
      ["empty output", ""],
      ["multiple JSON objects", `${latest(pin)}\n${latest(pin)}`],
      ["null response", "null"],
      ["array response", `[${latest(pin)}]`],
      ["missing tag", JSON.stringify({ draft: false, prerelease: false })],
      ["null tag", latest(null)],
      ["empty tag", latest("")],
      ["non-string tag", latest(123)],
      ["invalid version tag", latest("not-a-version")],
      ["prerelease tag", latest(`${pin}-rc.1`)],
      ["version with leading zero", latest("01.2.3")],
      ["version with trailing newline", latest(`${pin}\n`)],
      [
        "draft release",
        JSON.stringify({ tag_name: pin, draft: true, prerelease: false }),
      ],
      ["prerelease", JSON.stringify({ tag_name: pin, draft: false, prerelease: true })],
      ["missing stable markers", JSON.stringify({ tag_name: pin })],
      [
        "non-boolean stable markers",
        JSON.stringify({ tag_name: pin, draft: "false", prerelease: "false" }),
      ],
    ])("fails closed on %s", (_name, response) => {
      expect(checkerFixture(name, { response }).execute().status).not.toBe(0)
    })

    it("fails when the official request fails despite a matching response body", () => {
      const fixture = checkerFixture(name, { status: 23 })
      expect(fixture.execute().status).not.toBe(0)
      expect(
        fixture.calls().some((args) => args.some((arg) => arg.endsWith(endpoint))),
      ).toBe(true)
    })

    it.each([
      undefined,
      null,
      123,
      "^1.2.3",
      "~1.2.3",
      ">=1.2.3",
      "1.2.x",
      "*",
      "latest",
      "",
      "file:../package",
      "1.2.3-rc.1",
      "01.2.3",
      "1.2.3\n",
    ])("rejects the missing, malformed or non-exact pin %j", (value) => {
      expect(checkerFixture(name, { pin: value }).execute().status).not.toBe(0)
    })
  },
)
