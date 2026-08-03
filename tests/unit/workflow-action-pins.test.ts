// A moved tag on a third-party action is code execution inside a job that
// holds this repository's deployment secrets. github-release.yml already pins
// every action to a commit; this makes that the rule rather than one file's
// habit.
import { readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

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
})
