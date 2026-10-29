// A moved tag on a third-party action is code execution inside a job that
// holds this repository's deployment secrets. github-release.yml already pins
// every action to a commit; this makes that the rule rather than one file's
// habit.
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { readWorkflow } from "../fixtures/workflow"

const WORKFLOW_DIR = fileURLToPath(new URL("../../.github/workflows/", import.meta.url))

// `uses: owner/repo@ref` or `uses: owner/repo/path@ref`. Local (`./…`) and
// container (`docker://…`) references are not tag-pinnable and are excluded.
const USES = /^\s*(?:-\s*)?uses:\s*(?!\.\/|docker:\/\/)(\S+)/gm
const PINNED = /@[0-9a-f]{40}$/

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR).filter((name) => name.endsWith(".yml"))
}

describe("workflow action pinning", () => {
  it("finds workflow files to check", () => {
    expect(workflowFiles().length).toBeGreaterThan(0)
  })

  it.each(workflowFiles())("%s pins every external action to a commit", (file) => {
    const source = readFileSync(`${WORKFLOW_DIR}${file}`, "utf8")
    const unpinned = [...source.matchAll(USES)]
      .map((match) => match[1]!)
      .filter((reference) => !PINNED.test(reference))
    expect(unpinned).toEqual([])
  })

  it("pins both deployment actions to the same exact stable Wrangler version recorded in deployment docs", () => {
    const steps = Object.values(readWorkflow("cloudflare-pages.yml").jobs)
      .flatMap((job) => job.steps)
      .filter((step) => step.uses?.startsWith("cloudflare/wrangler-action@"))
    expect(steps).toHaveLength(2)
    const versions = steps.map((step) => step.with?.wranglerVersion)
    for (const version of versions) {
      expect(version).toMatch(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/)
    }
    expect(new Set(versions).size).toBe(1)
    const deployment = readFileSync(
      new URL("../../docs/develop/deployment.md", import.meta.url),
      "utf8",
    )
    // The release coder supplies the assessed version; this test does not invent one.
    expect(deployment).toMatch(
      new RegExp(
        `Wrangler(?:Version)?[\\s\\x60:@=]*${String(versions[0]).replaceAll(".", "\\.")}(?![\\d.])`,
        "i",
      ),
    )
  })

  it("removing project Wrangler also removes its lock importer and exclusive installed subtree", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>
      devDependencies?: Record<string, string>
      aube: { overrides: Record<string, string> }
    }
    const lock = parse(
      readFileSync(new URL("../../aube-lock.yaml", import.meta.url), "utf8"),
    ) as {
      importers: Record<string, { dependencies?: object; devDependencies?: object }>
      packages: Record<string, unknown>
      overrides: Record<string, string>
    }
    if (manifest.dependencies?.wrangler || manifest.devDependencies?.wrangler) return
    expect(lock.importers["."]?.dependencies ?? {}).not.toHaveProperty("wrangler")
    expect(lock.importers["."]?.devDependencies ?? {}).not.toHaveProperty("wrangler")
    expect(
      Object.keys(lock.packages).filter((name) =>
        /^(?:wrangler|miniflare|workerd|sharp|@img\/sharp[^@]*)@/.test(name),
      ),
    ).toEqual([])
    expect(manifest.aube.overrides).not.toHaveProperty("sharp")
    expect(lock.overrides).not.toHaveProperty("sharp")
  })
})
