import { describe, expect, it } from "vitest"
import { stringify } from "yaml"
import { parseReleaseWorkflow, releaseWorkflowSource } from "../fixtures/workflow"

function dependencies(value: string | string[] | undefined): string[] {
  return value === undefined ? [] : typeof value === "string" ? [value] : [...value].sort()
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
})
