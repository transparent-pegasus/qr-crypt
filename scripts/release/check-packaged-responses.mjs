// Playwright runs this after starting its owned archive server, before any
// browser scenario. A fallback page must never masquerade as a loadable asset.
import assert from "node:assert/strict"
import { readFile, readdir } from "node:fs/promises"
import path from "node:path"
import { request } from "@playwright/test"

export default async function checkPackagedResponses(config) {
  const root = process.env.E2E_ARTIFACT_ROOT
  const client = await request.newContext({
    baseURL: config.projects[0].use.baseURL,
    maxRedirects: 0,
  })
  const check = async (url, file, mime) => {
    const response = await client.get(url)
    assert.equal(response.status(), 200, `HTTP status: ${url}`)
    assert.equal(
      response.headers()["content-type"]?.split(";")[0],
      mime,
      `Content-Type: ${url}`,
    )
    assert.deepEqual(
      await response.body(),
      await readFile(path.join(root, file)),
      `Response differs from extracted bytes: ${url}`,
    )
    return response.headers()
  }

  try {
    const sentinel = await check(
      "/reachability-sentinel.txt",
      "reachability-sentinel.txt",
      "text/plain",
    )
    assert.equal(
      await readFile(path.join(root, "reachability-sentinel.txt"), "utf8"),
      "QR-CRYPT-REACHABLE",
    )
    assert.match(sentinel["cache-control"] ?? "", /\bno-store\b/i)

    const headers = await check("/", "index.html", "text/html")
    const csp = headers["content-security-policy"] ?? ""
    assert.match(csp, /connect-src 'self'/)
    assert.match(csp, /object-src 'none'/)
    assert.match(csp, /'wasm-unsafe-eval'/)
    assert.doesNotMatch(csp, /'unsafe-eval'/)
    await check("/nonexistent/spa/route", "index.html", "text/html")
    await check(
      "/manifest.webmanifest",
      "manifest.webmanifest",
      "application/manifest+json",
    )

    const mimeTypes = new Map([
      [".js", "text/javascript"],
      [".css", "text/css"],
      [".wasm", "application/wasm"],
    ])
    for (const file of await readdir(root, { recursive: true })) {
      const mime = mimeTypes.get(path.extname(file))
      if (mime) await check(`/${file.split(path.sep).join("/")}`, file, mime)
    }
  } finally {
    await client.dispose()
  }
}
