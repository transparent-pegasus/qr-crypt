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
  it.each([
    { name: "unset mode without _headers", mode: undefined, headers: false },
    { name: "required mode without _headers", mode: "required", headers: false },
    { name: "bogus mode with valid _headers", mode: "bogus", headers: true },
    { name: "empty mode with valid _headers", mode: "", headers: true },
  ])(
    "rejects startup for $name",
    async ({ mode, headers }) => {
      const temporary = await mkdtemp(path.join(tmpdir(), "qrypt-serve-dist-"))
      const root = path.join(temporary, "dist")
      const port = await reservePort()
      let server: ReturnType<typeof spawn> | undefined

      try {
        await mkdir(root)
        await writeFile(
          path.join(root, "index.html"),
          "<!doctype html><title>Test</title>",
        )
        if (headers) {
          await writeFile(
            path.join(root, "_headers"),
            "/*\n  Content-Security-Policy: default-src 'none'\n",
          )
        }
        const env: NodeJS.ProcessEnv = {
          ...process.env,
          SERVE_DIST_PORT: String(port),
          SERVE_DIST_ROOT: root,
        }
        delete env.SERVE_DIST_HEADERS
        if (mode !== undefined) env.SERVE_DIST_HEADERS = mode

        let stderr = ""
        server = spawn("aube", ["run", "serve:dist"], {
          cwd: process.cwd(),
          env,
          stdio: ["ignore", "ignore", "pipe"],
          timeout: 10_000,
        })
        server.stderr?.setEncoding("utf8")
        server.stderr?.on("data", (chunk: string) => {
          stderr += chunk
        })
        const exitCode = await new Promise<number | null>((resolve, reject) => {
          server?.once("error", reject)
          server?.once("exit", (code) => resolve(code))
        })

        expect(exitCode).toBe(1)
        expect(stderr).toContain("SERVE_DIST_START_FAILED")
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
    },
    15_000,
  )

  it("serves index.html without _headers or a CSP response header in none mode", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "qrypt-serve-dist-"))
    const root = path.join(temporary, "dist")
    const index = "<!doctype html><title>Header-less relay</title>"
    const port = await reservePort()
    let server: ReturnType<typeof spawn> | undefined

    try {
      await mkdir(root)
      await writeFile(path.join(root, "index.html"), index)
      server = spawn("aube", ["run", "serve:dist"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SERVE_DIST_PORT: String(port),
          SERVE_DIST_ROOT: root,
          SERVE_DIST_HEADERS: "none",
        },
        stdio: "ignore",
      })
      const baseUrl = `http://127.0.0.1:${port}`
      const deadline = Date.now() + 10_000
      let response: Response | undefined
      while (Date.now() < deadline) {
        if (server.exitCode !== null || server.signalCode !== null) break
        try {
          response = await fetch(`${baseUrl}/`)
          break
        } catch {
          // The child process may still be binding its socket.
        }
        await delay(25)
      }

      expect(response, "none mode must start without _headers").toBeDefined()
      expect(response!.status).toBe(200)
      expect(await response!.text()).toBe(index)
      expect(response!.headers.get("Content-Security-Policy")).toBeNull()
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

  it("rejects malformed headers during startup", async () => {
    const temporary = await mkdtemp(path.join(tmpdir(), "qrypt-serve-dist-"))
    const root = path.join(temporary, "dist")
    const port = await reservePort()
    let server: ReturnType<typeof spawn> | undefined

    try {
      await mkdir(root)
      await writeFile(
        path.join(root, "_headers"),
        "/*\n  Content-Security-Policy default-src 'none'\n",
      )

      let stderr = ""
      server = spawn("aube", ["run", "serve:dist"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          SERVE_DIST_PORT: String(port),
          SERVE_DIST_ROOT: root,
        },
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 10_000,
      })
      server.stderr?.setEncoding("utf8")
      server.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })
      const exitCode = await new Promise<number | null>((resolve, reject) => {
        server?.once("error", reject)
        server?.once("exit", (code) => resolve(code))
      })

      expect(exitCode).toBe(1)
      expect(stderr).toContain("SERVE_DIST_START_FAILED")
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
