import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"

describe("native relay host configuration", () => {
  it("embeds the relay with one permission-free main window and no dev URL", () => {
    const config = JSON.parse(
      readFileSync(
        new URL("../../native/desktop/tauri.conf.json", import.meta.url),
        "utf8",
      ),
    )

    expect(config).toMatchObject({
      identifier: "org.qrcrypt.relay",
      productName: "QR Crypt Relay",
      version: "../../package.json",
      build: { frontendDist: "../../dist-relay" },
      app: {
        windows: [],
        withGlobalTauri: false,
        security: { csp: null },
      },
    })
    expect(config.build).not.toHaveProperty("devUrl")
    // An absent or empty selection would include capability files by default.
    expect(config.app.security.capabilities).toEqual([
      { identifier: "relay", windows: ["main"], permissions: [] },
    ])
    expect(config.plugins ?? {}).toEqual({})
  })
})
