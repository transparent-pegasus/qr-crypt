import { readFileSync } from "node:fs"
import { parse } from "yaml"

interface WorkflowStep {
  id?: string
  run?: string
  if?: string | boolean
  "continue-on-error"?: string | boolean
}

interface WorkflowJob {
  needs?: string | string[]
  steps: WorkflowStep[]
}

interface ReleaseWorkflow {
  jobs: Record<"build" | "sign" | "publish", WorkflowJob>
}

export const releaseWorkflowSource = readFileSync(
  new URL("../../.github/workflows/github-release.yml", import.meta.url),
  "utf8",
)

export function parseReleaseWorkflow(source = releaseWorkflowSource): ReleaseWorkflow {
  return parse(source) as ReleaseWorkflow
}
