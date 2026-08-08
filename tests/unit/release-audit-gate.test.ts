import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"

const WORKFLOW_PATH = fileURLToPath(
  new URL("../../.github/workflows/github-release.yml", import.meta.url),
)
const WORKFLOW = readFileSync(WORKFLOW_PATH, "utf8")

function jobSource(name: string): string {
  const lines = WORKFLOW.split("\n")
  const opening = `  ${name}:`
  const start = lines.findIndex((line) => line === opening)
  if (start === -1) throw new Error(`JOB_NOT_FOUND:${name}`)

  const end = lines.findIndex(
    (line, index) => index > start && /^ {2}[a-z0-9_-]+:$/.test(line),
  )
  return lines.slice(start, end === -1 ? undefined : end).join("\n")
}

function steps(job: string): string[] {
  const lines = job.split("\n")
  const starts = lines.flatMap((line, index) =>
    /^ {6}- /.test(line) ? [index] : [],
  )
  return starts.map((start, index) =>
    lines.slice(start, starts[index + 1]).join("\n"),
  )
}

function exactRunStep(jobSteps: string[], command: string): number {
  return jobSteps.findIndex((step) =>
    step.split("\n").some((line) => line.trim() === `run: ${command}`),
  )
}

function needs(job: string): string[] {
  const lines = job.split("\n")
  const start = lines.findIndex((line) => /^ {4}needs:/.test(line))
  if (start === -1) return []

  const scalar = /^ {4}needs:\s+([a-z0-9_-]+)$/.exec(lines[start] as string)
  if (scalar) return [scalar[1] as string]

  const dependencies: string[] = []
  for (const line of lines.slice(start + 1)) {
    const item = /^ {6}- ([a-z0-9_-]+)$/.exec(line)
    if (!item) break
    dependencies.push(item[1] as string)
  }
  return dependencies
}

describe("signed release audit gate", () => {
  it("audits after install and before packaging without a bypass", () => {
    const buildSteps = steps(jobSource("build"))
    const install = exactRunStep(buildSteps, "aube ci")
    const audit = exactRunStep(buildSteps, "aube audit")
    const packaging = buildSteps.findIndex((step) => /^ {8}id: package$/m.test(step))

    expect(install).toBeGreaterThanOrEqual(0)
    expect(audit).toBeGreaterThan(install)
    expect(packaging).toBeGreaterThan(audit)
    expect(buildSteps[audit]).not.toMatch(/^\s+(?:if|continue-on-error):/m)
  })

  it("makes signing and publication depend on the audited build", () => {
    expect(needs(jobSource("sign"))).toEqual(["build"])
    expect(needs(jobSource("publish"))).toEqual(["build", "sign"])
  })
})
