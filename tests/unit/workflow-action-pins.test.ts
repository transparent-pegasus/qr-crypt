// A moved tag on a third-party action is code execution inside a job that
// holds this repository's deployment secrets. github-release.yml already pins
// every action to a commit; this makes that the rule rather than one file's
// habit.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parse } from "yaml"
import { readWorkflow } from "../fixtures/workflow"

const WORKFLOW_DIR = fileURLToPath(new URL("../../.github/workflows/", import.meta.url))

// `uses: owner/repo@ref` or `uses: owner/repo/path@ref`. Local (`./…`) and
// container (`docker://…`) references are not tag-pinnable and are excluded.
const USES = /^\s*(?:-\s*)?uses:\s*(?!\.\/|docker:\/\/)(\S+)/gm
const PINNED = /@[0-9a-f]{40}$/
const DEPLOY_COMMAND =
  '"$GITHUB_WORKSPACE/deploy/node_modules/.bin/wrangler" pages deploy "$GITHUB_WORKSPACE/dist" --project-name="$PAGES_PROJECT"'

function workflowFiles(): string[] {
  return readdirSync(WORKFLOW_DIR).filter((name) => /\.ya?ml$/.test(name))
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

  it("no workflow step uses cloudflare/wrangler-action", () => {
    const references = workflowFiles().flatMap((file) =>
      Object.values(readWorkflow(file).jobs).flatMap((job) =>
        job.steps
          .filter((step) => step.uses?.startsWith("cloudflare/wrangler-action"))
          .map((step) => ({ file, uses: step.uses })),
      ),
    )
    expect(references).toEqual([])
  })

  it("both Pages deploy steps run the locked Wrangler from runner.temp", () => {
    const steps = readWorkflow("cloudflare-pages.yml").jobs.deploy!.steps.filter((step) =>
      step.run?.includes("pages deploy"),
    )
    expect(steps).toHaveLength(2)
    for (const [condition, project] of [
      ["github.ref == 'refs/heads/main'", "${{ vars.CLOUDFLARE_PAGES_PROJECT }}"],
      ["github.ref == 'refs/heads/dev'", "${{ vars.CLOUDFLARE_PAGES_PROJECT_DEV }}"],
    ]) {
      const branchSteps = steps.filter((step) => step.if === condition)
      expect(branchSteps, condition).toHaveLength(1)
      expect(branchSteps[0]?.run?.trim()).toBe(DEPLOY_COMMAND)
      expect(branchSteps[0]?.["working-directory"]).toBe("${{ runner.temp }}")
      expect(branchSteps[0]?.env?.PAGES_PROJECT).toBe(project)
    }
  })

  it("deploy secrets stay in the deploy steps", () => {
    const workflow = readWorkflow("cloudflare-pages.yml")
    const steps = workflow.jobs.deploy!.steps.filter((step) =>
      step.run?.includes("pages deploy"),
    )
    expect(steps).toHaveLength(2)
    for (const step of steps) {
      expect(step.env).toEqual({
        CLOUDFLARE_API_TOKEN: "${{ secrets.CLOUDFLARE_API_TOKEN }}",
        CLOUDFLARE_ACCOUNT_ID: "${{ secrets.CLOUDFLARE_ACCOUNT_ID }}",
        PAGES_PROJECT: expect.stringMatching(
          /^\$\{\{ vars\.CLOUDFLARE_PAGES_PROJECT(?:_DEV)? \}\}$/,
        ),
      })
      delete step.env
    }
    expect(JSON.stringify(workflow)).not.toMatch(/CLOUDFLARE_(?:API_TOKEN|ACCOUNT_ID)/)
    expect(JSON.stringify(workflow)).not.toContain("gitHubToken")
  })

  it("deploy job installs the locked toolchain before it deploys", () => {
    const job = readWorkflow("cloudflare-pages.yml").jobs.deploy!
    const steps = job.steps
    const checkout = steps.findIndex((step) => step.uses?.startsWith("actions/checkout@"))
    const mise = steps.findIndex((step) => step.uses?.startsWith("jdx/mise-action@"))
    const install = steps.findIndex((step) => step.run?.trim() === "aube -C deploy ci")
    const download = steps.findIndex((step) =>
      step.uses?.startsWith("actions/download-artifact@"),
    )
    const projectCheck = steps.findIndex(
      (step) => step.name === "Require the target Pages project to be configured",
    )
    const deployments = steps.flatMap((step, index) =>
      step.run?.includes("pages deploy") ? [index] : [],
    )

    expect(steps[projectCheck]?.env).toEqual({
      PAGES_PROJECT_MAIN: "${{ vars.CLOUDFLARE_PAGES_PROJECT }}",
      PAGES_PROJECT_DEV: "${{ vars.CLOUDFLARE_PAGES_PROJECT_DEV }}",
    })
    expect(steps[projectCheck]?.run).toBeTypeOf("string")
    for (const [ref, main, dev, status] of [
      ["refs/heads/main", "configured-main", "configured-dev", 0],
      ["refs/heads/dev", "configured-main", "configured-dev", 0],
      ["refs/heads/main", "", "configured-dev", 1],
      ["refs/heads/dev", "configured-main", "", 1],
      ["refs/heads/other", "configured-main", "configured-dev", 1],
    ] as const) {
      const result = spawnSync("bash", ["-c", steps[projectCheck]!.run!], {
        encoding: "utf8",
        env: { GITHUB_REF: ref, PAGES_PROJECT_MAIN: main, PAGES_PROJECT_DEV: dev },
        timeout: 5_000,
      })
      expect(result.error).toBeUndefined()
      expect(result.status, `${ref}, main=${main}, dev=${dev}: ${result.stderr}`).toBe(status)
    }

    expect(checkout, "checkout must precede tool installation and artifact download").toBe(0)
    expect(mise).toBeGreaterThan(checkout)
    expect(install).toBeGreaterThan(mise)
    expect(download).toBeGreaterThan(install)
    expect(projectCheck).toBeGreaterThan(download)
    expect(deployments).toHaveLength(2)
    for (const index of deployments) expect(index).toBeGreaterThan(projectCheck)
    expect(steps[checkout]).toMatchObject({
      uses: "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      with: { "persist-credentials": false, "sparse-checkout-cone-mode": false },
    })
    expect(
      (steps[checkout]?.with?.["sparse-checkout"] as string | undefined)?.trim().split(/\s+/),
    ).toEqual(["/deploy/**", "/mise.toml"])
    expect(steps[mise]).toMatchObject({
      uses: "jdx/mise-action@f10502fc09dadecfefb962fff68ce77213930204",
      with: { install: true, cache: false },
    })
    expect(steps[download]).toMatchObject({
      uses: "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
      with: { name: "dist-${{ github.sha }}", path: "dist" },
    })
    expect(job.permissions).toEqual({ contents: "read" })
    expect(job.needs).toEqual(["validate", "e2e"])
    expect(job).toMatchObject({
      if: "github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/dev')",
      "runs-on": "ubuntu-latest",
      "timeout-minutes": 10,
    })
  })

  it("deploy manifest pins Wrangler exactly to the version recorded in deployment docs", () => {
    const manifestUrl = new URL("../../deploy/package.json", import.meta.url)
    const lockUrl = new URL("../../deploy/aube-lock.yaml", import.meta.url)
    expect(
      { manifest: existsSync(manifestUrl), lock: existsSync(lockUrl) },
      "deploy/package.json and deploy/aube-lock.yaml must both be committed",
    ).toEqual({ manifest: true, lock: true })
    const manifestSource = readFileSync(manifestUrl, "utf8")
    const manifest = JSON.parse(manifestSource) as {
      dependencies: { wrangler: string }
    }
    expect(manifest).toEqual({
      name: "qr-crypt-deploy",
      private: true,
      license: "Apache-2.0",
      dependencies: { wrangler: "4.155.0" },
    })
    expect(manifestSource).toBe(`${JSON.stringify(manifest, null, 2)}\n`)
    const version = manifest.dependencies.wrangler
    expect(version).toMatch(/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/)
    const lock = parse(readFileSync(lockUrl, "utf8")) as {
      importers: Record<string, { dependencies?: { wrangler?: { specifier: string; version: string } } }>
    }
    expect(lock.importers["."]?.dependencies?.wrangler).toEqual({
      specifier: version,
      version,
    })
    const deployment = readFileSync(
      new URL("../../docs/develop/deployment.md", import.meta.url),
      "utf8",
    )
    expect(deployment).toMatch(
      new RegExp(
        `Wrangler(?:Version)?[\\s\\x60:@=]*${version.replaceAll(".", "\\.")}(?![\\d.])`,
        "i",
      ),
    )
  })

  it("validate gates the deploy toolchain", () => {
    const { jobs } = readWorkflow("cloudflare-pages.yml")
    const steps = jobs.validate!.steps
    let previous = steps.findIndex((step) => step.name === "Audit dependencies")
    expect(previous).toBeGreaterThanOrEqual(0)
    for (const [name, command] of [
      ["Install the deploy toolchain", "aube -C deploy ci"],
      ["Audit the deploy toolchain", "aube -C deploy audit"],
      [
        "Smoke-test the deploy toolchain",
        'deploy/node_modules/.bin/wrangler --version | grep -Fx "4.155.0"',
      ],
    ]) {
      const index = steps.findIndex((step) => step.name === name)
      expect(index, name).toBeGreaterThan(previous)
      const step = steps[index]!
      expect(step.run?.trim()).toBe(command)
      expect(step).not.toHaveProperty("if")
      expect(step).not.toHaveProperty("continue-on-error")
      expect(step.run).not.toMatch(/\|\|\s*(?:true\b|:)/)
      previous = index
    }
    expect(jobs.deploy!.needs).toEqual(["validate", "e2e"])
  })

  it("security maintenance audits the deploy toolchain", () => {
    const steps = readWorkflow("security-maintenance.yml").jobs["external-security"]!.steps
    let previous = steps.findIndex((step) => step.name === "Audit dependency advisories")
    expect(previous).toBeGreaterThanOrEqual(0)
    for (const command of ["aube -C deploy ci", "aube -C deploy audit"]) {
      const index = steps.findIndex((step) => step.run?.trim() === command)
      expect(index, command).toBeGreaterThan(previous)
      expect(steps[index]?.if).toBe("${{ !cancelled() }}")
      expect(steps[index]).not.toHaveProperty("continue-on-error")
      previous = index
    }
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
