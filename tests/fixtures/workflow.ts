import { readFileSync } from "node:fs"
import { parse } from "yaml"

export interface WorkflowStep {
  name?: string
  id?: string
  uses?: string
  run?: string
  if?: string | boolean
  env?: Record<string, string>
  with?: Record<string, unknown>
  "continue-on-error"?: string | boolean
}

interface WorkflowJob {
  needs?: string | string[]
  outputs?: Record<string, string>
  steps: WorkflowStep[]
}

export interface Workflow {
  jobs: Record<string, WorkflowJob>
}

interface ReleaseWorkflow extends Workflow {
  jobs: Record<"build" | "sign" | "publish", WorkflowJob>
}

export const releaseWorkflowSource = readFileSync(
  new URL("../../.github/workflows/github-release.yml", import.meta.url),
  "utf8",
)

export function parseReleaseWorkflow(source = releaseWorkflowSource): ReleaseWorkflow {
  return parse(source) as ReleaseWorkflow
}

export function readWorkflow(name: string): Workflow {
  return parse(
    readFileSync(new URL(`../../.github/workflows/${name}`, import.meta.url), "utf8"),
  ) as Workflow
}
