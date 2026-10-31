import { describe, expect, it } from "vitest"
import { readWorkflow } from "../fixtures/workflow"

describe("artifact-producing toolchain", () => {
  it.each([
    ["github-release.yml", "build"],
    ["cloudflare-pages.yml", "validate"],
    // Ordinary Playwright mode builds dist through its configured webServer.
    ["cloudflare-pages.yml", "e2e"],
  ])("%s %s disables reusable mise caches", (file, name) => {
    const steps = readWorkflow(file).jobs[name]!.steps.filter((step) =>
      step.uses?.startsWith("jdx/mise-action@"),
    )
    expect(steps.length).toBeGreaterThan(0)
    for (const step of steps) expect([false, "false"]).toContain(step.with?.cache)
  })

  it.each([
    ["github-release.yml", "build"],
    ["cloudflare-pages.yml", "validate"],
  ])("%s %s invokes the complete Vitest suite exactly once", (file, name) => {
    const commands = readWorkflow(file)
      .jobs[name]!.steps.flatMap((step) => (step.run ?? "").split("\n"))
      .filter((line) => /\baube run test(?=\s|:|$)/.test(line))
    expect(commands).toHaveLength(1)
    expect(commands[0]).toMatch(/^\s*aube run test(?:\s+--\s+--maxWorkers=\d+)?\s*$/)
  })

  it("keeps every existing Node and UI test family in the default Vitest invocation", async () => {
    const config = (await import("../../vitest.config")).default as {
      test: { projects: { test: { include: string[] } }[] }
    }
    const included = config.test.projects.flatMap((project) => project.test.include)
    for (const glob of [
      "tests/unit/**/*.test.ts",
      "tests/integration/**/*.test.ts",
      "tests/pq/**/*.test.ts",
      "tests/pq-vectors/**/*.test.ts",
      "tests/qr-multipart/**/*.test.ts",
      "tests/ui/**/*.test.tsx",
    ]) {
      expect(
        included.filter((value) => value === glob),
        glob,
      ).toHaveLength(1)
    }
  })
})
