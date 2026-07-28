import { createHash } from "node:crypto"
import { defineConfig, devices } from "@playwright/test"

// Worktrees share one host, so a fixed port plus reuseExistingServer can silently
// exercise another checkout's dist. Give each checkout a stable port; an actual
// collision fails closed and can be resolved with the explicit override.
const configuredPort =
  process.env.E2E_SERVER_PORT === undefined
    ? undefined
    : Number(process.env.E2E_SERVER_PORT)
if (
  configuredPort !== undefined &&
  (!Number.isSafeInteger(configuredPort) ||
    configuredPort < 1_024 ||
    configuredPort > 65_535)
) {
  throw new Error("E2E_SERVER_PORT must be an integer from 1024 through 65535")
}
const e2ePort =
  configuredPort ??
  20_000 +
    (createHash("sha256").update(process.cwd()).digest().readUInt16BE(0) % 20_000)

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  // CI job timeout is 30 min; fail with a report before GH kills the job silently
  globalTimeout: process.env.CI ? 25 * 60_000 : 0,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: `http://127.0.0.1:${e2ePort}` },
  webServer: {
    command: "aube run build:prod && aube run serve:dist",
    env: { SERVE_DIST_PORT: String(e2ePort) },
    port: e2ePort,
    reuseExistingServer: false,
    timeout: 240_000,
  },
  projects: [
    {
      name: "mobile-chromium",
      use: {
        ...devices["Pixel 7"],
        permissions: ["camera"],
        launchOptions: {
          args: [
            "--use-fake-ui-for-media-stream",
            "--use-fake-device-for-media-stream",
          ],
        },
      },
    },
  ],
})
