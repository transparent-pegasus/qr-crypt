import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import {
  cspForRootPattern,
  deploymentPolicyFromHeaders,
  META_UNSUPPORTED_DIRECTIVES,
  metaCspFromHeaders,
} from "../../scripts/csp-from-headers.mjs"

const SAMPLE = `/*
  Content-Security-Policy: default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; frame-ancestors 'none'; report-uri /r; sandbox
  X-Frame-Options: DENY

/index.html
  Cache-Control: no-cache
`

describe("csp-from-headers", () => {
  it("returns the CSP declared for the /* rule", () => {
    expect(cspForRootPattern(SAMPLE)).toContain("script-src 'self' 'wasm-unsafe-eval'")
  })

  it("drops every directive a meta CSP cannot express", () => {
    const meta = metaCspFromHeaders(SAMPLE)
    for (const name of META_UNSUPPORTED_DIRECTIVES) {
      expect(meta).not.toContain(name)
    }
  })

  it("keeps every supported directive in the original order", () => {
    expect(metaCspFromHeaders(SAMPLE)).toBe(
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'none'",
    )
  })

  it("throws when the /* rule declares no CSP", () => {
    expect(() => cspForRootPattern("/index.html\n  Cache-Control: no-cache\n")).toThrow()
  })

  it("derives a meta policy from the real public/_headers", async () => {
    const text = await import("node:fs/promises").then((fs) =>
      fs.readFile(new URL("../../public/_headers", import.meta.url), "utf8"),
    )
    const meta = metaCspFromHeaders(text)
    expect(meta).toContain("connect-src 'self'")
    expect(meta).not.toContain("frame-ancestors")
  })
})

describe("deploymentPolicyFromHeaders", () => {
  it("extracts the /* security headers and the sentinel cache rule", () => {
    const text = readFileSync(
      new URL("../../public/_headers", import.meta.url),
      "utf8",
    )
    const policy = deploymentPolicyFromHeaders(text)

    expect(Object.keys(policy.root).sort()).toEqual([
      "content-security-policy",
      "cross-origin-opener-policy",
      "cross-origin-resource-policy",
      "permissions-policy",
      "referrer-policy",
      "x-content-type-options",
      "x-frame-options",
    ])
    expect(policy.root["x-frame-options"]).toBe("DENY")
    expect(policy.root["cross-origin-opener-policy"]).toBe("same-origin")
    expect(policy.sentinelCacheControl).toBe("no-store")
  })

  it("rejects a headers file with no sentinel rule", () => {
    // Complete /* block so ROOT_INCOMPLETE does not fire first — the claim
    // under test is the missing sentinel rule, not an incomplete root set.
    const text = `/*
  Content-Security-Policy: default-src 'self'
  Referrer-Policy: no-referrer
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  Permissions-Policy: camera=(self)
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
`
    expect(() => deploymentPolicyFromHeaders(text)).toThrow("HEADERS_SENTINEL_MISSING")
  })
})
