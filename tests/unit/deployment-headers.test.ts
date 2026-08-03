import { describe, expect, it } from "vitest"
import { evaluateDeploymentHeaders } from "@/lib/deployment-headers"

const SENTINEL_URL = "https://127.0.0.1:8080/reachability-sentinel.txt?n=abc"

function conformingResponse(
  overrides: Record<string, string> = {},
  options: { status?: number; body?: BodyInit | null } = {},
): Response {
  const policy = __DEPLOYMENT_HEADER_POLICY__
  const headers = new Headers({
    ...policy.root,
    "cache-control": policy.sentinelCacheControl,
    "content-type": "text/plain",
    ...overrides,
  })
  const status = options.status ?? 200
  // Node's Response rejects a body on 204/205/304; null is required there.
  const body = options.body !== undefined ? options.body : "QR-CRYPT-REACHABLE"
  const response = new Response(body, { status, headers })
  Object.defineProperty(response, "url", {
    value: SENTINEL_URL,
    configurable: true,
  })
  return response
}

describe("evaluateDeploymentHeaders", () => {
  it("passes a fully conforming sentinel response", () => {
    const verdict = evaluateDeploymentHeaders(conformingResponse(), SENTINEL_URL, 1000)
    expect(verdict.status).toBe("pass")
    expect(verdict.failedFields).toEqual([])
    expect(verdict.checkedAt).toBe(1000)
  })

  it.each([
    "content-security-policy",
    "referrer-policy",
    "x-content-type-options",
    "x-frame-options",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
  ])("fails when %s is missing", (field) => {
    const response = conformingResponse()
    response.headers.delete(field)
    const verdict = evaluateDeploymentHeaders(response, SENTINEL_URL, 1000)
    expect(verdict.status).toBe("fail")
    expect(verdict.failedFields).toContain(field)
  })

  it("fails when a header value differs", () => {
    const verdict = evaluateDeploymentHeaders(
      conformingResponse({ "x-frame-options": "SAMEORIGIN" }),
      SENTINEL_URL,
      1000,
    )
    expect(verdict.status).toBe("fail")
    expect(verdict.failedFields).toContain("x-frame-options")
  })

  it("fails on a wrong sentinel cache-control", () => {
    const verdict = evaluateDeploymentHeaders(
      conformingResponse({ "cache-control": "public, max-age=60" }),
      SENTINEL_URL,
      1000,
    )
    expect(verdict.failedFields).toContain("cache-control")
  })

  it("fails on a non-text/plain content-type", () => {
    const verdict = evaluateDeploymentHeaders(
      conformingResponse({ "content-type": "text/html" }),
      SENTINEL_URL,
      1000,
    )
    expect(verdict.failedFields).toContain("content-type")
  })

  it("fails when the response url is not the requested sentinel", () => {
    const response = conformingResponse()
    Object.defineProperty(response, "url", {
      value: "https://evil.example/reachability-sentinel.txt",
      configurable: true,
    })
    const verdict = evaluateDeploymentHeaders(response, SENTINEL_URL, 1000)
    expect(verdict.failedFields).toContain("url")
  })

  it("fails a redirected response", () => {
    const response = conformingResponse()
    Object.defineProperty(response, "redirected", {
      value: true,
      configurable: true,
    })
    const verdict = evaluateDeploymentHeaders(response, SENTINEL_URL, 1000)
    expect(verdict.failedFields).toContain("redirected")
  })

  it("fails a non-200 status", () => {
    const response = conformingResponse({}, { status: 204, body: null })
    const verdict = evaluateDeploymentHeaders(response, SENTINEL_URL, 1000)
    expect(verdict.failedFields).toContain("status")
  })
})
