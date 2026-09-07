import { spawn, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import path from "node:path"

const REPO_ROOT = path.resolve(import.meta.dirname, "../..")
export const DAMAGED_ASSET_ERROR = "QR_CRYPT_DAMAGED_ARTIFACT_EXECUTED"

export async function treeDigests(root: string) {
  const result: Record<string, string> = {}
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const filename = path.join(entry.parentPath, entry.name)
    result[path.relative(root, filename)] = createHash("sha256")
      .update(await readFile(filename))
      .digest("hex")
  }
  return result
}

async function unusedPort(excluded: Set<number>): Promise<number> {
  for (;;) {
    const reservation = createServer()
    await new Promise<void>((resolve, reject) => {
      reservation.once("error", reject)
      reservation.listen(0, "127.0.0.1", resolve)
    })
    const address = reservation.address()
    await new Promise<void>((resolve, reject) => {
      reservation.close((error) => (error ? reject(error) : resolve()))
    })
    if (address === null || typeof address === "string") {
      throw new Error("Could not allocate an artifact browser port")
    }
    if (!excluded.has(address.port)) {
      excluded.add(address.port)
      return address.port
    }
  }
}

export async function artifactBoot(root: string, output: string, usedPorts: Set<number>) {
  const port = await unusedPort(usedPorts)
  await mkdir(path.dirname(output), { recursive: true })
  // The config must supply its root. Do not inherit a server root that could
  // accidentally make the baseline serve the intended copy.
  const inheritedEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => key !== "SERVE_DIST_ROOT" && key !== "SERVE_DIST_PORT",
    ),
  )
  const child = spawn(
    "aube",
    [
      "run",
      "test:e2e",
      "--",
      "tests/e2e/app-boot.spec.ts",
      "--workers=1",
      "--retries=0",
      "--timeout=45000",
      "--global-timeout=120000",
      "--reporter=line",
      "--trace=on",
      `--output=${output}`,
    ],
    {
      cwd: REPO_ROOT,
      env: {
        ...inheritedEnv,
        E2E_ARTIFACT_ROOT: root,
        E2E_SERVER_PORT: String(port),
      },
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
  let stdout = ""
  let stderr = ""
  child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
    stdout += chunk
  })
  child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
    stderr += chunk
  })
  const stop = (signal: NodeJS.Signals) => {
    if (child.pid === undefined) return
    try {
      if (process.platform === "win32") child.kill(signal)
      else process.kill(-child.pid, signal)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error
    }
  }
  let timedOut = false
  let forceStop: ReturnType<typeof setTimeout> | undefined
  const deadline = setTimeout(() => {
    timedOut = true
    stop("SIGTERM")
    forceStop = setTimeout(() => stop("SIGKILL"), 5_000)
  }, 150_000)
  try {
    const outcome = await new Promise<{ code: number | null; signal: string | null }>(
      (resolve, reject) => {
        child.once("error", reject)
        child.once("close", (code, signal) => resolve({ code, signal }))
      },
    )
    await writeFile(`${output}.log`, `${stdout}\n${stderr}`)
    return { ...outcome, port, timedOut, stdout, stderr }
  } finally {
    clearTimeout(deadline)
    clearTimeout(forceStop)
    // Playwright owns server/browser teardown; also stop its remaining process group.
    stop("SIGKILL")
  }
}

export async function tracePageErrors(output: string) {
  const traces = (await readdir(output, { recursive: true }))
    .filter((name) => path.basename(name) === "trace.zip")
    .map((name) => path.join(output, name))
  if (traces.length === 0) throw new Error(`No browser trace was produced in ${output}`)
  const result = spawnSync(
    "python3",
    [
      "-c",
      `import json, sys, zipfile
errors = []
for filename in sys.argv[1:]:
    with zipfile.ZipFile(filename) as archive:
        for name in archive.namelist():
            if not name.endswith(".trace"):
                continue
            for line in archive.read(name).splitlines():
                event = json.loads(line)
                if event.get("type") == "event" and event.get("method") == "pageError":
                    errors.append(json.dumps(event.get("params", {})))
print(json.dumps(errors))
`,
      ...traces,
    ],
    { encoding: "utf8", timeout: 10_000, maxBuffer: 2 * 1024 * 1024 },
  )
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(result.stderr)
  return { traces, pageErrors: JSON.parse(result.stdout) as string[] }
}
