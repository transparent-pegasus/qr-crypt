import { expect, test } from "@playwright/test"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { existingExecutable, mayTerminateChild, validateLaunchInputs } from "./launcher"
import { redactEvidence } from "./native-fixture"

const sha = "0123456789abcdef0123456789abcdef01234567"
const helperContents = "inert PowerShell selector fixture; never executed\n"
const helperSha256 = "eb9c7526e2e524b4386a13d81460b35ae18e54d7cb58e50678059c2ef6fe237a"

test("native evidence removes plain, escaped and forward-slash Windows user paths", () => {
  for (const [source, expected] of [
    ["C:\\Users\\private-name\\capture", "<user-profile>\\capture"],
    ["C:\\\\Users\\\\private-name\\\\capture", "<user-profile>\\\\capture"],
    ["C:/Users/private-name/capture", "<user-profile>/capture"],
  ]) {
    expect(redactEvidence(source!, "D:\\owned", "D:\\release.exe")).toBe(expected)
  }
  expect(
    redactEvidence("D:\\owned\\profile D:\\release.exe", "D:\\owned", "D:\\release.exe"),
  ).toBe("<owned-storage>\\profile <release-exe>")
  expect(
    redactEvidence("http://tauri.localhost " + sha, "D:\\owned", "D:\\release.exe"),
  ).toBe("http://tauri.localhost " + sha)
  expect
    .soft(() => {
      expect(redactEvidence(23, "D:\\owned", "D:\\release.exe")).toBe("23")
    })
    .not.toThrow()
  expect
    .soft(() => {
      expect(redactEvidence(0, "D:\\owned", "D:\\release.exe")).toBe("0")
    })
    .not.toThrow()
})

test("launcher rejects unsupported hosts, relative executables and mismatched source identities", async () => {
  expect(() => validateLaunchInputs("linux", undefined, undefined, sha)).toThrow(
    "NATIVE_RELAY_SETUP: Windows is required (host: linux)",
  )
  for (const executable of [
    undefined,
    "",
    "qr-crypt-relay.exe",
    "C:relay.exe",
    "\\relay.exe",
    "C:\\release\\relay.cmd",
  ]) {
    expect(() => validateLaunchInputs("win32", executable, sha, sha)).toThrow(
      /NATIVE_RELAY_SETUP: NATIVE_RELAY_EXE/,
    )
  }
  for (const build of [undefined, "dev", sha.slice(0, 39), "g".repeat(40)]) {
    expect(() =>
      validateLaunchInputs("win32", "C:\\release\\qr-crypt-relay.exe", build, sha),
    ).toThrow(/NATIVE_RELAY_SETUP: VITE_BUILD_SHA/)
  }
  expect(() =>
    validateLaunchInputs("win32", "C:\\release\\qr-crypt-relay.exe", "a".repeat(40), sha),
  ).toThrow(/checkout HEAD/)
  expect(
    validateLaunchInputs("win32", "C:\\release\\qr-crypt-relay.exe", sha, sha),
  ).toEqual({ executable: "C:\\release\\qr-crypt-relay.exe", buildSha: sha })

  const { selectPowerShell } = await import("./launcher")
  expect(selectPowerShell, "launcher must export selected-host validation").toEqual(
    expect.any(Function),
  )
  for (const executable of [
    undefined,
    "",
    "pwsh.exe",
    ".\\pwsh.exe",
    "C:pwsh.exe",
    "\\pwsh.exe",
    "/pwsh.exe",
    "\\\\server\\share\\pwsh.exe",
    "//server/share/pwsh.exe",
    "\\\\?\\C:\\selected\\pwsh.exe",
    "C:\\selected\\powershell.exe",
    "C:\\selected\\pwsh.cmd",
    "C:\\selected\\other-pwsh.exe",
    "C:\\selected\\pwsh.exe.old",
  ]) {
    await expect(
      selectPowerShell(
        executable,
        { source: sha, pwsh: "C:\\selected\\pwsh.exe", pwsh_sha256: helperSha256 },
        sha,
      ),
      String(executable),
    ).rejects.toThrow(/^NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH/)
  }
})

test("launcher cleanup refuses an unrelated PID and never kills an exited child", () => {
  expect(() =>
    mayTerminateChild({ pid: 123, exitCode: null, signalCode: null }, 456),
  ).toThrow(/ownership/)
  expect(() =>
    mayTerminateChild({ pid: undefined, exitCode: null, signalCode: null }, 123),
  ).toThrow(/ownership/)
  expect(mayTerminateChild({ pid: 123, exitCode: 0, signalCode: null }, 123)).toBe(false)
  expect(
    mayTerminateChild({ pid: 123, exitCode: null, signalCode: "SIGTERM" }, 123),
  ).toBe(false)
  expect(mayTerminateChild({ pid: 123, exitCode: null, signalCode: null }, 123)).toBe(
    true,
  )
})

// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test("launcher requires an existing regular executable file before spawning", async ({}, testInfo) => {
  const directory = testInfo.outputPath("candidate")
  await mkdir(directory, { recursive: true })
  const candidate = testInfo.outputPath("candidate", "qr-crypt-relay.exe")
  await expect(existingExecutable(candidate)).rejects.toThrow(
    /NATIVE_RELAY_SETUP: NATIVE_RELAY_EXE/,
  )
  await expect(existingExecutable(directory)).rejects.toThrow(
    /NATIVE_RELAY_SETUP: NATIVE_RELAY_EXE/,
  )
  await writeFile(candidate, "inert launcher validation fixture; never executed")
  expect(await existingExecutable(candidate)).toBe(await realpath(candidate))

  if (process.platform === "win32") {
    const { selectPowerShell } = await import("./launcher")
    expect(selectPowerShell, "launcher must export selected-host validation").toEqual(
      expect.any(Function),
    )
    const hostDirectory = testInfo.outputPath("selected host")
    await mkdir(hostDirectory)
    const helper = testInfo.outputPath("selected host", "pwsh.exe")
    await writeFile(helper, helperContents)
    const executable = await realpath(helper)
    const expected = { source: sha, pwsh: executable, pwsh_sha256: helperSha256 }
    const selected = { executable, sha256: helperSha256 }
    await expect(selectPowerShell(helper, expected, sha)).resolves.toEqual(selected)
    await expect(
      selectPowerShell(
        helper.toUpperCase(),
        { ...expected, pwsh: executable.toUpperCase() },
        sha,
      ),
    ).resolves.toEqual(selected)

    const missing = testInfo.outputPath("missing host", "pwsh.exe")
    const directory = testInfo.outputPath("directory host", "pwsh.exe")
    await mkdir(directory, { recursive: true })
    for (const path of [missing, directory]) {
      await expect(
        selectPowerShell(path, { ...expected, pwsh: path }, sha),
      ).rejects.toThrow(/^NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH/)
    }

    const wrongName = testInfo.outputPath("selected host", "powershell.exe")
    await writeFile(wrongName, helperContents)
    await expect(
      selectPowerShell(wrongName, { ...expected, pwsh: wrongName }, sha),
    ).rejects.toThrow(/^NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH/)

    const otherDirectory = testInfo.outputPath("other host")
    await mkdir(otherDirectory)
    const otherHelper = testInfo.outputPath("other host", "pwsh.exe")
    await writeFile(otherHelper, helperContents)
    for (const identity of [
      { ...expected, source: "a".repeat(40) },
      { ...expected, pwsh: await realpath(otherHelper) },
      { ...expected, pwsh_sha256: "0".repeat(64) },
      { ...expected, pwsh_sha256: helperSha256.toUpperCase() },
    ]) {
      await expect(selectPowerShell(helper, identity, sha)).rejects.toThrow(
        /^NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH/,
      )
    }
    await writeFile(helper, helperContents + "changed bytes\n")
    await expect(selectPowerShell(helper, expected, sha)).rejects.toThrow(
      /^NATIVE_RELAY_SETUP: NATIVE_RELAY_PWSH/,
    )
  }
})
