import { spawn } from "node:child_process"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { tmpdir } from "node:os"
import path from "node:path"
import { setTimeout as delay } from "node:timers/promises"
import { describe, expect, it } from "vitest"

const reservePort = async (): Promise<number> => {
  const probe = createServer()
  await new Promise<void>((resolve, reject) => {
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", resolve)
  })
  const address = probe.address()
  if (address === null || typeof address === "string") {
    probe.close()
    throw new Error("SERVE_DIST_TEST_PORT_FAILED")
  }
  await new Promise<void>((resolve, reject) => {
    probe.close((error) => (error === undefined ? resolve() : reject(error)))
  })
  return address.port
}

describe("serve-dist", () => {
  it("rejects a symlink that resolves outside the document root", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "qrypt-serve-dist-"))
    const root = path.join(temporary, "dist")
    const outside = path.join(temporary, "outside.txt")
    const port = await reservePort()
    let server: ReturnType<typeof spawn> | undefined

    try {
      await mkdir(root)
      await writeFile(
        path.join(root, "_headers"),
        "/*\n  Content-Security-Policy: default-src 'none'\n",
      )
      await writeFile(path.join(root, "index.html"), "<!doctype html><title>Test</title>")
      await writeFile(outside, "outside document root")
      await symlink(outside, path.join(root, "escape.txt"))

      server = spawn("aube", ["run", "serve:dist"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SERVE_DIST_PORT: String(port),
          SERVE_DIST_ROOT: root,
        },
        stdio: "ignore",
      })
      const baseUrl = `http://127.0.0.1:${port}`
      const deadline = Date.now() + 10_000
      while (true) {
        if (server.exitCode !== null || server.signalCode !== null) {
          throw new Error("SERVE_DIST_TEST_SERVER_EXITED")
        }
        try {
          const response = await fetch(`${baseUrl}/`)
          if (response.ok) break
        } catch {
          // The child process may still be binding its socket.
        }
        if (Date.now() >= deadline) {
          throw new Error("SERVE_DIST_TEST_SERVER_NOT_READY")
        }
        await delay(25)
      }

      const response = await fetch(`${baseUrl}/escape.txt`)

      expect(response.status).toBe(400)
    } finally {
      if (
        server !== undefined &&
        server.exitCode === null &&
        server.signalCode === null
      ) {
        const exited = new Promise<void>((resolve) =>
          server?.once("exit", () => resolve()),
        )
        server.kill("SIGTERM")
        await exited
      }
      await rm(temporary, { force: true, recursive: true })
    }
  }, 15_000)
})
