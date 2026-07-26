// Header-aware static server for the built PWA. Single source of truth for
// "_headers / _redirects semantics", shared by Playwright's webServer and the
// release workflow's packaged-PWA e2e run, so both exercise the same header
// behaviour the deployed origin provides.
//
// realpathSync mirrors the release job: the containment check below must compare
// resolved paths, or a symlink under the document root escapes it.
import fs from "node:fs"
import fsp from "node:fs/promises"
import http from "node:http"
import path from "node:path"

try {
  const root = fs.realpathSync(path.resolve(process.env.SERVE_DIST_ROOT ?? "dist"))
  const port = Number(process.env.SERVE_DIST_PORT ?? 4173)

  const rules = []
  {
    let activeRule
    const text = await fsp.readFile(path.join(root, "_headers"), "utf8")
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
  }

  const matches = (pattern, pathname) =>
    pattern === "/*"
      ? true
      : pattern.endsWith("*")
        ? pathname.startsWith(pattern.slice(0, -1))
        : pathname === pattern

  const mimeTypes = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".txt", "text/plain; charset=utf-8"],
    [".wasm", "application/wasm"],
    [".webmanifest", "application/manifest+json; charset=utf-8"],
  ])

  const server = http.createServer(async (request, response) => {
    try {
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.writeHead(405, { Allow: "GET, HEAD" })
        response.end()
        return
      }

      let pathname
      try {
        pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname)
      } catch {
        response.writeHead(400)
        response.end()
        return
      }

      const relative = pathname === "/" ? "index.html" : pathname.slice(1)
      const lexical = path.resolve(root, relative)
      if (lexical !== root && !lexical.startsWith(`${root}${path.sep}`)) {
        response.writeHead(400)
        response.end()
        return
      }

      // Resolve the candidate itself, not only the root: a symlink inside the
      // document root is followed by stat/readFile, so a lexical prefix check
      // alone does not contain it.
      const contained = async (candidate) => {
        const real = await fsp.realpath(candidate).catch(() => undefined)
        if (real === undefined) return undefined
        if (real !== root && !real.startsWith(`${root}${path.sep}`)) return null
        return real
      }

      let filePath = await contained(lexical)
      if (filePath === null) {
        response.writeHead(400)
        response.end()
        return
      }
      const file =
        filePath === undefined ? undefined : await fsp.stat(filePath).catch(() => undefined)
      if (!file?.isFile()) filePath = await contained(path.join(root, "index.html"))
      if (filePath === undefined || filePath === null) {
        response.writeHead(400)
        response.end()
        return
      }
      const body = await fsp.readFile(filePath)
      const headers = {}
      for (const rule of rules) {
        if (matches(rule.pattern, pathname)) Object.assign(headers, rule.headers)
      }
      headers["Content-Type"] =
        mimeTypes.get(path.extname(filePath)) ?? "application/octet-stream"
      headers["Content-Length"] = String(body.length)
      response.writeHead(200, headers)
      response.end(request.method === "HEAD" ? undefined : body)
    } catch {
      // Fixed output only: a request-derived path or caught message must not reach logs.
      process.stderr.write("SERVE_DIST_REQUEST_FAILED\n")
      response.writeHead(500)
      response.end()
    }
  })

  // Startup and listen failures must not print SERVE_DIST_ROOT or a raw stack: the
  // release workflow prints this log.
  server.on("error", () => {
    process.stderr.write("SERVE_DIST_LISTEN_FAILED\n")
    process.exit(1)
  })
  server.listen(port, "127.0.0.1")
  process.on("SIGTERM", () => server.close(() => process.exit(0)))
} catch {
  process.stderr.write("SERVE_DIST_START_FAILED\n")
  process.exit(1)
}
