import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createFixture,
  releaseScript,
  REPO_ROOT,
  run,
  writeFiles,
} from "../fixtures/release-fixture"
import { testedArchiveFixture } from "../fixtures/tested-archive"

async function loadConfig(env: Record<string, string | undefined> = {}) {
  vi.stubEnv("E2E_ARTIFACT_ROOT", undefined)
  vi.stubEnv("E2E_SERVER_PORT", undefined)
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value)
  vi.resetModules()
  const { default: config } = await import("../../playwright.config")
  const server = config.webServer
  if (server === undefined || Array.isArray(server)) {
    throw new Error("Expected one reference server in the real Playwright config")
  }
  return { config, server }
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe("Playwright document-root selection", () => {
  it("builds and serves the checkout when artifact mode is unset", async () => {
    const { config, server } = await loadConfig({ E2E_SERVER_PORT: "31234" })
    expect(server.command).toBe("aube run build:prod && aube run serve:dist")
    expect(server.reuseExistingServer).toBe(false)
    expect(server.port).toBe(31234)
    expect(server.env?.SERVE_DIST_PORT).toBe("31234")
    expect(config.use?.baseURL).toBe("http://127.0.0.1:31234")
  })

  it("serves the exact selected artifact root without building or reusing a server", async () => {
    const fixture = createFixture()
    const root = path.join(fixture.directory, "selected artifact ' $ ; root")
    mkdirSync(root)
    const { config, server } = await loadConfig({
      E2E_ARTIFACT_ROOT: root,
      E2E_SERVER_PORT: "31235",
    })
    expect(server.command).toBe("aube run serve:dist")
    expect(server.env?.SERVE_DIST_ROOT).toBe(root)
    expect(server.env?.SERVE_DIST_PORT).toBe("31235")
    expect(server.port).toBe(31235)
    expect(server.reuseExistingServer).toBe(false)
    expect(config.use?.baseURL).toBe("http://127.0.0.1:31235")
  })

  it.each(["empty", "relative", "missing", "file"] as const)(
    "rejects an explicitly %s artifact root instead of falling back to the checkout",
    async (kind) => {
      const fixture = createFixture()
      const file = path.join(fixture.directory, "ordinary-file")
      writeFileSync(file, "not a directory")
      const roots = {
        empty: "",
        relative: path.relative(REPO_ROOT, fixture.root),
        missing: path.join(fixture.directory, "missing"),
        file,
      }
      await expect(loadConfig({ E2E_ARTIFACT_ROOT: roots[kind] })).rejects.toThrow()
    },
  )

  describe.each(["checkout", "artifact"] as const)("%s server port", (mode) => {
    it.each(["", "1023", "65536", "12.5", "NaN", "Infinity"])(
      "rejects invalid port %j",
      async (port) => {
        const fixture = createFixture()
        await expect(
          loadConfig({
            E2E_SERVER_PORT: port,
            E2E_ARTIFACT_ROOT: mode === "artifact" ? fixture.root : undefined,
          }),
        ).rejects.toThrow(/E2E_SERVER_PORT/)
      },
    )

    it.each(["1024", "65535"])("accepts boundary port %s", async (port) => {
      const fixture = createFixture()
      const { config, server } = await loadConfig({
        E2E_SERVER_PORT: port,
        E2E_ARTIFACT_ROOT: mode === "artifact" ? fixture.root : undefined,
      })
      expect(server.port).toBe(Number(port))
      expect(server.env?.SERVE_DIST_PORT).toBe(port)
      expect(server.reuseExistingServer).toBe(false)
      expect(config.use?.baseURL).toBe(`http://127.0.0.1:${port}`)
    })
  })
})

interface ReleaseCall {
  command: string
  args: string[]
  artifactRoot?: string
}

function releaseGateFixture() {
  const fixture = testedArchiveFixture()
  const bin = path.join(fixture.directory, "bin")
  const output = path.join(fixture.runnerTemp, "github-output")
  const calls = path.join(fixture.directory, "calls.jsonl")
  mkdirSync(bin)
  for (const name of ["aube", "curl"]) {
    const destination = path.join(bin, name)
    copyFileSync(
      path.join(REPO_ROOT, "tests/fixtures/release-test-command.py"),
      destination,
    )
    chmodSync(destination, 0o755)
  }
  writeFileSync(output, "")
  writeFileSync(calls, "")
  return {
    ...fixture,
    output: () => readFileSync(output, "utf8"),
    browserCalls: () =>
      readFileSync(calls, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as ReleaseCall)
        .filter((call) => call.command === "aube" && call.args[1] === "test:e2e"),
    execute: (env: NodeJS.ProcessEnv = {}) =>
      run(fixture.root, "bash", [releaseScript("test-packaged-pwa.sh")], {
        PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
        ARCHIVE_NAME: fixture.archiveName,
        RUNNER_TEMP: fixture.runnerTemp,
        GITHUB_OUTPUT: output,
        RELEASE_TEST_ROOT: fixture.extracted,
        RELEASE_TEST_CALLS: calls,
        ...env,
      }),
  }
}

describe("packaged release browser gate", () => {
  it("exports the same tested archive digest and selects its extracted root for every browser call", () => {
    const fixture = releaseGateFixture()
    const outcome = fixture.execute()
    expect(outcome.status, outcome.stderr).toBe(0)
    expect(fixture.output().split("\n")).toContain(
      `tested_archive_sha256=${fixture.digest}`,
    )
    const calls = fixture.browserCalls()
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) expect(call.artifactRoot).toBe(fixture.extracted)
  })

  it.each(["archive", "INSTALL.txt", "SHA256SUMS.files", "extra", "missing"])(
    "rejects pre-test %s corruption before invoking browser tests or exporting a digest",
    (kind) => {
      const fixture = releaseGateFixture()
      if (kind === "archive") appendFileSync(fixture.archive, "changed archive")
      else if (kind === "extra") writeFiles(fixture.extracted, { "extra.txt": "extra" })
      else if (kind === "missing") rmSync(path.join(fixture.extracted, "INSTALL.txt"))
      else appendFileSync(path.join(fixture.extracted, kind), "changed member")
      const outcome = fixture.execute()
      expect(outcome.status).not.toBe(0)
      expect(fixture.browserCalls()).toEqual([])
      expect(fixture.output()).not.toContain("tested_archive_sha256=")
    },
  )

  it.each([
    "archive",
    "assets/app-1234abcd.js",
    "INSTALL.txt",
    "SHA256SUMS.files",
    "extra",
    "missing",
  ])(
    "rejects %s corruption during otherwise successful browser tests and exports no digest",
    (kind) => {
      const fixture = releaseGateFixture()
      const target =
        kind === "archive"
          ? fixture.archive
          : path.join(
              fixture.extracted,
              kind === "extra" ? "extra.txt" : kind === "missing" ? "INSTALL.txt" : kind,
            )
      const outcome = fixture.execute({
        RELEASE_TEST_MUTATION: JSON.stringify({
          path: target,
          remove: kind === "missing",
        }),
      })
      expect(fixture.browserCalls().length).toBeGreaterThan(0)
      expect(outcome.status).not.toBe(0)
      expect(fixture.output()).not.toContain("tested_archive_sha256=")
    },
  )

  it("does not advertise tested bytes after a browser test fails", () => {
    const fixture = releaseGateFixture()
    const outcome = fixture.execute({ RELEASE_TEST_BROWSER_STATUS: "7" })
    expect(fixture.browserCalls().length).toBeGreaterThan(0)
    expect(outcome.status).not.toBe(0)
    expect(fixture.output()).not.toContain("tested_archive_sha256=")
  })
})
