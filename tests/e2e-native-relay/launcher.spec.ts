import { expect, test } from "@playwright/test"
import { mkdir, realpath, writeFile } from "node:fs/promises"
import { existingExecutable, mayTerminateChild, validateLaunchInputs } from "./launcher"
import { redactEvidence } from "./native-fixture"

const sha = "0123456789abcdef0123456789abcdef01234567"

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
})

test("launcher rejects unsupported hosts, relative executables and mismatched source identities", () => {
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
})
