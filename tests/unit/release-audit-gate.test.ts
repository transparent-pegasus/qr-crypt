import { describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { parseReleaseWorkflow, releaseWorkflowSource } from "../fixtures/workflow"

function dependencies(value: string | string[] | undefined): string[] {
  return value === undefined
    ? []
    : typeof value === "string"
      ? [value]
      : [...value].sort()
}

// Exercise the same assertions after formatting-only changes to the real
// workflow, including equivalent scalar, block-list and flow-list needs.
const blockNeeds = parseReleaseWorkflow()
blockNeeds.jobs.sign.needs = dependencies(blockNeeds.jobs.sign.needs)

describe.each([
  { name: "repository formatting", source: releaseWorkflowSource },
  {
    name: "four-space indentation, literal commands and block needs",
    source: stringify(blockNeeds, {
      indent: 4,
      defaultKeyType: "PLAIN",
      defaultStringType: "BLOCK_LITERAL",
    }),
  },
  {
    name: "three-space indentation and folded commands",
    source: stringify(blockNeeds, {
      indent: 3,
      defaultKeyType: "PLAIN",
      defaultStringType: "BLOCK_FOLDED",
    }),
  },
  {
    name: "flow collections and quoted commands",
    source: stringify(blockNeeds, {
      collectionStyle: "flow",
      defaultStringType: "QUOTE_DOUBLE",
      lineWidth: 0,
    }),
  },
])("signed release audit gate ($name)", ({ source }) => {
  it("audits after install and before packaging without a bypass", () => {
    const buildSteps = parseReleaseWorkflow(source).jobs.build.steps
    const install = buildSteps.findIndex((step) => step.run?.trim() === "aube ci")
    const audit = buildSteps.findIndex((step) => step.run?.trim() === "aube audit")
    const packaging = buildSteps.findIndex((step) => step.id === "package")

    expect(install).toBeGreaterThanOrEqual(0)
    expect(audit).toBeGreaterThan(install)
    expect(packaging).toBeGreaterThan(audit)
    expect(buildSteps[audit]).not.toHaveProperty("if")
    expect(buildSteps[audit]).not.toHaveProperty("continue-on-error")
  })

  it("makes signing and publication depend on the audited build", () => {
    const { jobs } = parseReleaseWorkflow(source)
    expect(dependencies(jobs.sign.needs)).toEqual(["build"])
    expect(dependencies(jobs.publish.needs)).toEqual(["build", "sign"])
  })

  it("installs browser tooling before creating the package whose bytes will be tested", () => {
    const steps = parseReleaseWorkflow(source).jobs.build.steps
    const browserInstall = steps.findIndex((step) =>
      /\baube exec playwright install\b/.test(step.run ?? ""),
    )
    const packaging = steps.findIndex((step) => step.id === "package")
    const browserTest = steps.findIndex((step) => step.id === "test-package")
    expect(browserInstall).toBeGreaterThanOrEqual(0)
    expect(packaging).toBeGreaterThan(browserInstall)
    expect(browserTest).toBeGreaterThan(packaging)
    expect(steps[browserInstall]).not.toHaveProperty("if")
    expect(steps[browserInstall]).not.toHaveProperty("continue-on-error")
  })

  it("carries the package-time and browser-tested digests independently into sign and publish", () => {
    const { jobs } = parseReleaseWorkflow(source)
    expect(jobs.build.outputs?.["packaged-archive-sha256"]).toBe(
      "${{ steps.package.outputs.packaged_archive_sha256 }}",
    )
    expect(jobs.build.outputs?.["tested-archive-sha256"]).toBe(
      "${{ steps.test-package.outputs.tested_archive_sha256 }}",
    )
    const signing = jobs.sign.steps.find((step) => step.run?.includes("cosign sign-blob"))
    const publishing = jobs.publish.steps.find((step) => step.run !== undefined)
    for (const step of [signing, publishing]) {
      expect(step?.env?.PACKAGED_ARCHIVE_SHA256).toBe(
        "${{ needs.build.outputs.packaged-archive-sha256 }}",
      )
      expect(step?.env?.TESTED_ARCHIVE_SHA256).toBe(
        "${{ needs.build.outputs.tested-archive-sha256 }}",
      )
    }
  })
})
