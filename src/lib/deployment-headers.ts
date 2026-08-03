// Deployment-header conformance for the reachability sentinel response.
//
// Scope, deliberately narrow: this detects an honest server that ignores
// public/_headers. It does NOT prove the top-level navigation response carries
// the same headers — a per-path misconfiguration, or a hostile server, can
// serve the sentinel correctly and index.html incorrectly. An independent,
// pre-provisioned deployment checker remains required; see NS-08 in
// docs/security/threat-model.md.
//
// The sentinel is the only route excluded from the service worker
// (NetworkOnly in vite.config.ts), so it is the one response that is
// guaranteed to come from the actual server rather than the precache.

const SENTINEL_CONTENT_TYPE = "text/plain"

export interface DeploymentVerdict {
  status: "pass" | "fail"
  failedFields: readonly string[]
  checkedAt: number
}

function contentTypeMatches(value: string | null): boolean {
  if (value === null) return false
  return value.split(";")[0]?.trim().toLowerCase() === SENTINEL_CONTENT_TYPE
}

export function evaluateDeploymentHeaders(
  response: Response,
  expectedUrl: string,
  now: number,
): DeploymentVerdict {
  const policy = __DEPLOYMENT_HEADER_POLICY__
  const failedFields: string[] = []

  if (response.status !== 200) failedFields.push("status")
  if (response.redirected) failedFields.push("redirected")
  if (response.url !== "" && response.url !== expectedUrl) failedFields.push("url")

  for (const [name, expected] of Object.entries(policy.root)) {
    if (response.headers.get(name) !== expected) failedFields.push(name)
  }

  if (response.headers.get("cache-control") !== policy.sentinelCacheControl) {
    failedFields.push("cache-control")
  }
  if (!contentTypeMatches(response.headers.get("content-type"))) {
    failedFields.push("content-type")
  }

  return {
    status: failedFields.length === 0 ? "pass" : "fail",
    failedFields,
    checkedAt: now,
  }
}
