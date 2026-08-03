// Derive the meta-tag CSP from public/_headers so the policy has exactly one
// source of truth. A meta http-equiv CSP ignores some directives; they are
// dropped here and stay in _headers only. The list is exported so the e2e
// assertion computes the expected meta value with the same rule.

export function parseHeadersFile(text) {
  const rules = []
  let activeRule
  for (const rawLine of text.split("\n")) {
    if (rawLine.trim() === "") continue
    if (!rawLine.startsWith(" ") && !rawLine.startsWith("\t")) {
      activeRule = { pattern: rawLine.trim(), headers: {} }
      rules.push(activeRule)
      continue
    }
    if (!activeRule) throw new Error("HEADERS_PARSE_FAILED")
    const separator = rawLine.indexOf(":")
    if (separator < 1) throw new Error("HEADERS_PARSE_FAILED")
    activeRule.headers[rawLine.slice(0, separator).trim()] = rawLine
      .slice(separator + 1)
      .trim()
  }
  return rules
}

export function cspForRootPattern(text) {
  const root = parseHeadersFile(text).find((rule) => rule.pattern === "/*")
  const csp = root?.headers["Content-Security-Policy"]
  if (typeof csp !== "string" || csp.trim() === "") {
    throw new Error("HEADERS_CSP_MISSING")
  }
  return csp
}

// Ignored inside a meta http-equiv CSP; these stay in _headers only.
export const META_UNSUPPORTED_DIRECTIVES = Object.freeze([
  "frame-ancestors",
  "report-uri",
  "sandbox",
])

export function metaCspFromHeaders(text) {
  return cspForRootPattern(text)
    .split(";")
    .map((directive) => directive.trim())
    .filter((directive) => directive !== "")
    .filter((directive) => {
      const name = directive.split(/\s+/)[0]?.toLowerCase() ?? ""
      return !META_UNSUPPORTED_DIRECTIVES.includes(name)
    })
    .join("; ")
}

// The exact header set the runtime deployment gate compares against. Derived
// from _headers so a policy edit can never disagree with the check.
const ROOT_SECURITY_HEADERS = Object.freeze([
  "Content-Security-Policy",
  "Referrer-Policy",
  "X-Content-Type-Options",
  "X-Frame-Options",
  "Permissions-Policy",
  "Cross-Origin-Opener-Policy",
  "Cross-Origin-Resource-Policy",
])

export function deploymentPolicyFromHeaders(text) {
  const rules = parseHeadersFile(text)
  const root = rules.find((rule) => rule.pattern === "/*")
  if (!root) throw new Error("HEADERS_ROOT_MISSING")

  const extracted = {}
  for (const name of ROOT_SECURITY_HEADERS) {
    const value = root.headers[name]
    if (typeof value !== "string" || value.trim() === "") {
      throw new Error("HEADERS_ROOT_INCOMPLETE")
    }
    extracted[name.toLowerCase()] = value
  }

  const sentinel = rules.find(
    (rule) => rule.pattern === "/reachability-sentinel.txt",
  )
  const sentinelCacheControl = sentinel?.headers["Cache-Control"]
  if (typeof sentinelCacheControl !== "string" || sentinelCacheControl.trim() === "") {
    throw new Error("HEADERS_SENTINEL_MISSING")
  }

  return { root: extracted, sentinelCacheControl }
}
