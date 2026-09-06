import { spawnSync } from "node:child_process"
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { onTestFinished } from "vitest"

export const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
export const releaseScript = (name: string) =>
  path.join(REPO_ROOT, "scripts/release", name)

export function run(
  root: string,
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
) {
  // Inherited Git overrides must never redirect fixture commits into a worktree.
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  )
  const result = spawnSync(command, args, {
    cwd: root,
    env: {
      ...inherited,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      LC_ALL: "C",
      TZ: "UTC",
      ...env,
    },
    encoding: "utf8",
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  })
  if (result.error) throw result.error
  return result
}

export function createFixture() {
  const directory = mkdtempSync(path.join(tmpdir(), "qr-crypt-release-test-"))
  onTestFinished(() => rmSync(directory, { recursive: true, force: true }))
  const root = path.join(directory, "repo")
  const runnerTemp = path.join(directory, "runner")
  mkdirSync(path.join(root, "scripts"), { recursive: true })
  mkdirSync(runnerTemp)
  // The package entrypoint calls its real Node/Python siblings relative to cwd.
  // This link also permits a real missing-entrypoint failure before extraction.
  symlinkSync(path.join(REPO_ROOT, "scripts/release"), path.join(root, "scripts/release"))
  return { directory, root, runnerTemp }
}

export function writeFiles(root: string, files: Record<string, string | Uint8Array>) {
  for (const [name, bytes] of Object.entries(files)) {
    const file = path.join(root, name)
    mkdirSync(path.dirname(file), { recursive: true })
    writeFileSync(file, bytes)
  }
}

export function readFiles(root: string) {
  return Object.fromEntries(
    readdirSync(root, { recursive: true, encoding: "utf8" })
      .filter((name) => statSync(path.join(root, name)).isFile())
      .sort()
      .map((name) => [name, readFileSync(path.join(root, name))]),
  )
}

export function writeStaticDist(root: string, sourceSha = "fixture-build") {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1cAAAAASUVORK5CYII=",
    "base64",
  )
  const files = {
    "index.html":
      '<!doctype html>\n<a href="/">Home</a>\n' +
      '<link rel="manifest" href="/manifest.webmanifest">\n' +
      '<link rel="icon" href="/favicon.svg">\n' +
      '<link rel="stylesheet" href="/assets/style-87654321.css?cache=1#sheet">\n' +
      '<script type="module" src="/assets/app-1234abcd.js"></script>\n',
    "manifest.webmanifest": JSON.stringify({
      name: "Release fixture",
      start_url: "/",
      scope: "/",
      display: "standalone",
      icons: [{ src: "/icons/icon-192.png", type: "image/png" }],
    }),
    "sw.js":
      'importScripts("/workbox-1234abcd.js");\n' +
      "workbox.routing.registerRoute(/reachability-sentinel/, new workbox.strategies.NetworkOnly());\n" +
      'workbox.precaching.precacheAndRoute([{url:"/index.html", revision:"fixture"}]);\n',
    "workbox-1234abcd.js": "/* fixture Workbox runtime */\n",
    "assets/app-1234abcd.js":
      `globalThis.fixtureBuildSha = "${sourceSha}";\n` +
      'globalThis.fixtureWasm = "/assets/worker-11223344.wasm";\n',
    "assets/style-87654321.css": "body { color: black; }\n",
    "assets/worker-11223344.wasm": Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
    "favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"/>\n',
    "reachability-sentinel.txt": "QR-CRYPT-REACHABLE",
    _headers:
      "/*\n  Content-Security-Policy: default-src 'self'; connect-src 'self'\n" +
      "/reachability-sentinel.txt\n  Cache-Control: no-store\n",
    _redirects: "/* /index.html 200\n",
    "icons/apple-touch-icon-180.png": png,
    "icons/icon-192.png": png,
    "icons/icon-512.png": png,
    "icons/maskable-512.png": png,
  }
  writeFiles(path.join(root, "dist"), files)
  return Object.fromEntries(
    Object.entries(files).map(([name, bytes]) => [name, Buffer.from(bytes)]),
  )
}
