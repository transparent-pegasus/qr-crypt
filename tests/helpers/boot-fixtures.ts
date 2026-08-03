import { vi, beforeEach } from "vitest"
import {
  persistDeploymentVerdict,
} from "@/app/boot/boot-controller"
import type { BootDecisionSnapshot } from "@/app/boot/boot-controller"
import type { DeploymentVerdict } from "@/lib/deployment-headers"
import { resetDatabaseAccessBarrierForTesting } from "@/storage/database"

const PASSING_VERDICT: DeploymentVerdict = {
  status: "pass",
  failedFields: [],
  checkedAt: 1,
}

// D8: absence refuses. Seed a passing verdict for every UI test so suites that
// boot the real controller without injecting readDecision still reach
// offline-confirmed. Also clear the quarantine barrier between tests.
beforeEach(async () => {
  resetDatabaseAccessBarrierForTesting()
  await persistDeploymentVerdict(PASSING_VERDICT).catch(() => undefined)
})

export function response(
  body: string,
  status = 200,
  headerOverrides: Record<string, string | null> = {},
): Response {
  const policy = __DEPLOYMENT_HEADER_POLICY__
  const headers = new Headers({
    ...policy.root,
    "cache-control": policy.sentinelCacheControl,
    "content-type": "text/plain",
  })
  for (const [name, value] of Object.entries(headerOverrides)) {
    if (value === null) headers.delete(name)
    else headers.set(name, value)
  }
  // url stays "" so evaluateDeploymentHeaders skips the url field for synthetic
  // responses (the real probe passes location-resolved URLs with a nonce query
  // that a shared fixture cannot know ahead of time).
  return {
    status,
    headers,
    url: "",
    redirected: false,
    text: vi.fn(async () => body),
  } as unknown as Response
}

/** A server that serves the body but ignores public/_headers. */
export function responseMissingHeader(body: string, header: string): Response {
  return response(body, 200, { [header]: null })
}

export function decision(
  overrides: Partial<BootDecisionSnapshot> = {},
): BootDecisionSnapshot {
  const { deploymentVerdict: overrideVerdict, ...rest } = overrides
  const snapshot = {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...rest,
  }
  // exactOptionalPropertyTypes: omit the key for "absent", never assign undefined.
  const deploymentVerdict =
    "deploymentVerdict" in overrides ? overrideVerdict : PASSING_VERDICT
  return {
    ...snapshot,
    cleanOrigin:
      overrides.cleanOrigin ??
      (snapshot.sensitiveDataExists ? "dirty" : "confirmed-clean"),
    ...(deploymentVerdict !== undefined ? { deploymentVerdict } : {}),
  }
}
