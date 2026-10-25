import { mkdtemp, readFile, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join, matchesGlob, relative, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { build, type Plugin, type UserConfig } from "vite"
import { afterEach, describe, expect, it, vi } from "vitest"
import { relayViteConfig } from "../../vite.relay.config"
import { parseDocument } from "../../scripts/build-about-locales.mjs"
import { metaCspFromHeaders } from "../../scripts/csp-from-headers.mjs"
import { RELAY_ALLOWED_OUTPUT } from "../../scripts/relay-bundle-allowlist.mjs"

const outputDirectories: string[] = []

async function buildRelay(
  fixture?: string,
  overrides: Pick<UserConfig, "plugins" | "build"> = {},
): Promise<string> {
  const outDir = await mkdtemp(join(tmpdir(), "qr-crypt-relay-bundle-"))
  outputDirectories.push(outDir)
  const options = fixture
    ? {
        root: fileURLToPath(
          new URL(`../fixtures/relay-bundle/${fixture}/`, import.meta.url),
        ),
        outDir,
      }
    : { outDir }

  vi.stubEnv("NODE_ENV", "production")
  try {
    const config = relayViteConfig(options)
    await build({
      ...config,
      plugins: [...(config.plugins ?? []), ...(overrides.plugins ?? [])],
      build: { ...config.build, ...overrides.build },
      configFile: false,
      mode: "prod",
      logLevel: "silent",
    })
  } finally {
    vi.unstubAllEnvs()
  }
  return outDir
}

async function outputFileNames(outDir: string): Promise<string[]> {
  const entries = await readdir(outDir, { recursive: true, withFileTypes: true })
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(outDir, join(entry.parentPath, entry.name)).split(sep).join("/"),
    )
}

afterEach(async () => {
  await Promise.all(
    outputDirectories
      .splice(0)
      .map((outDir) => rm(outDir, { recursive: true, force: true })),
  )
})

describe("relay bundle build", () => {
  it("builds the real relay entry", async () => {
    const outDir = await buildRelay()
    const files = await outputFileNames(outDir)

    expect(files).toContain("index.html")
    expect(
      files.filter(
        (file) => !RELAY_ALLOWED_OUTPUT.some((pattern) => matchesGlob(file, pattern)),
      ),
    ).toEqual([])

    const document = await parseDocument(
      await readFile(join(outDir, "index.html"), "utf8"),
    )
    const metas = document.querySelectorAll(
      'meta[http-equiv="Content-Security-Policy" i]',
    )
    expect(metas).toHaveLength(1)
    expect(metas[0]?.getAttribute("content")).toBe(
      metaCspFromHeaders(
        await readFile(new URL("../../public/_headers", import.meta.url), "utf8"),
      ),
    )
  }, 60_000)

  it("fails on a static import of a banned module", async () => {
    await expect(buildRelay("static-import")).rejects.toThrow("src/lib/reachability.ts")
  }, 60_000)

  it("fails on a dynamic import of a banned module", async () => {
    await expect(buildRelay("dynamic-import")).rejects.toThrow("src/storage/database.ts")
  }, 60_000)

  it("fails on new Worker(new URL(...))", async () => {
    await expect(buildRelay("new-worker")).rejects.toThrow(
      "relay bundle must not build workers",
    )
  }, 60_000)

  it("fails on a ?worker import", async () => {
    await expect(buildRelay("worker-import")).rejects.toThrow(
      /relay bundle must not build workers|src\/workers\/pq-crypto\.worker\.ts\?worker/,
    )
  }, 60_000)

  it("rejects sw.js emitted by an appended plugin", async () => {
    const plugin: Plugin = {
      name: "test-forbidden-service-worker",
      generateBundle() {
        this.emitFile({ type: "asset", fileName: "sw.js", source: "self.skipWaiting()" })
      },
    }

    await expect(buildRelay(undefined, { plugins: [plugin] })).rejects.toThrow("sw.js")
  }, 60_000)

  it.each([
    { representation: "string", source: 'fetch("https://unreviewed.example/x")' },
    {
      representation: "Uint8Array",
      source: new TextEncoder().encode('fetch("https://unreviewed.example/x")'),
    },
  ])(
    "rejects an unlisted URL in a $representation asset source",
    async ({ source }) => {
      const plugin: Plugin = {
        name: "test-unreviewed-url",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "assets/extra.js", source })
        },
      }

      const result = buildRelay(undefined, { plugins: [plugin] })
      await expect(result).rejects.toThrow("https://unreviewed.example")
      await expect(result).rejects.toThrow("assets/extra.js")
    },
    60_000,
  )

  it("rejects .vite/manifest.json when build.manifest is enabled", async () => {
    await expect(
      buildRelay(undefined, { build: { manifest: true } }),
    ).rejects.toThrow(".vite/manifest.json")
  }, 60_000)

  it("rejects forbidden.txt emitted by a post-order generateBundle hook", async () => {
    const plugin: Plugin = {
      name: "test-late-forbidden-output",
      enforce: "post",
      generateBundle: {
        order: "post",
        handler() {
          this.emitFile({ type: "asset", fileName: "forbidden.txt", source: "late" })
        },
      },
    }

    await expect(buildRelay(undefined, { plugins: [plugin] })).rejects.toThrow(
      "forbidden.txt",
    )
  }, 60_000)

  it("the shipped CSS contains utilities used only by shared components", async () => {
    const outDir = await buildRelay()
    const cssFiles = (await outputFileNames(outDir)).filter((file) =>
      file.endsWith(".css"),
    )
    expect(cssFiles.length).toBeGreaterThan(0)
    const css = (
      await Promise.all(cssFiles.map((file) => readFile(join(outDir, file), "utf8")))
    ).join("\n")

    for (const utility of ["min-h-36", "aspect-square", "max-h-dvh"]) {
      expect(css).toMatch(new RegExp(`\\.${utility}\\s*\\{`))
    }
  }, 60_000)
})
