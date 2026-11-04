import type { ChildProcess } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, realpath, stat } from "node:fs/promises"
import { createServer } from "node:net"
import { win32 } from "node:path"

export function validateLaunchInputs(
  host: string,
  executable: string | undefined,
  buildSha: string | undefined,
  sourceHead: string,
): { executable: string; buildSha: string } {
  if (host !== "win32") {
    throw new Error("NATIVE_RELAY_SETUP: Windows is required (host: " + host + ")")
  }
  if (
    !executable ||
    !win32.isAbsolute(executable) ||
    !/^(?:[a-z]:[\\/]|\\\\[^\\]+\\[^\\]+)/i.test(executable) ||
    !/\.exe$/i.test(executable)
  ) {
    throw new Error(
      "NATIVE_RELAY_SETUP: NATIVE_RELAY_EXE must be an existing absolute release EXE path",
    )
  }
  if (!buildSha || !/^[a-f0-9]{40}$/i.test(buildSha)) {
    throw new Error(
      "NATIVE_RELAY_SETUP: VITE_BUILD_SHA must contain the complete 40-hex source commit",
    )
  }
  if (buildSha.toLowerCase() !== sourceHead.toLowerCase()) {
    throw new Error("NATIVE_RELAY_SETUP: VITE_BUILD_SHA must match checkout HEAD")
  }
  return { executable, buildSha }
}

export function mayTerminateChild(
  child: Pick<ChildProcess, "pid" | "exitCode" | "signalCode">,
  ownedPid: number,
): boolean {
  if (!Number.isSafeInteger(ownedPid) || ownedPid <= 0 || child.pid !== ownedPid) {
    throw new Error("NATIVE_RELAY_CLEANUP: child process ownership mismatch")
  }
  return child.exitCode === null && child.signalCode === null
}

export async function existingExecutable(executable: string): Promise<string> {
  try {
    const path = await realpath(executable)
    if ((await stat(path)).isFile()) return path
  } catch {
    /* Report the same setup error for missing and non-file candidates. */
  }
  throw new Error(
    "NATIVE_RELAY_SETUP: NATIVE_RELAY_EXE must be an existing absolute release EXE path",
  )
}

export async function selectPowerShell(
  executable: string | undefined,
  expected: { source: string; pwsh: string; pwsh_sha256: string },
  sourceHead: string,
): Promise<{ executable: string; sha256: string }> {
  try {
    if (
      executable &&
      /^[a-z]:[\\/]/i.test(executable) &&
      win32.basename(executable).toLowerCase() === "pwsh.exe"
    ) {
      const path = await realpath(executable)
      if (
        /^[a-z]:[\\/]/i.test(path) &&
        win32.basename(path).toLowerCase() === "pwsh.exe" &&
        (await stat(path)).isFile() &&
        expected.source === sourceHead &&
        path.toLowerCase() === expected.pwsh.toLowerCase()
      ) {
        const sha256 = createHash("sha256")
          .update(await readFile(path))
          .digest("hex")
        if (sha256 === expected.pwsh_sha256) return { executable: path, sha256 }
      }
    }
  } catch {
    /* Report the same setup error for missing and mismatched helper identities. */
  }
  throw new Error(
    "NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH must select the existing absolute pwsh.exe recorded in launcher/tool.json",
  )
}

export async function selectCdpPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", resolve)
  })
  const address = server.address()
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  )
  if (address === null || typeof address === "string")
    throw new Error("NATIVE_RELAY_SETUP: no loopback port")
  return address.port
}
