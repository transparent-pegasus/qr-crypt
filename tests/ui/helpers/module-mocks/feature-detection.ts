import { vi } from "vitest"
import * as fakes from "../fakes/feature-detection"

// Keep pure helpers such as isStandalone real; only environmental probes vary.
vi.mock("@/lib/feature-detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feature-detect")>()),
  detectFeatures: fakes.detectFeatures,
  probeWebAssemblyRuntime: fakes.probeWebAssemblyRuntime,
  webAssemblyRuntimeSupport: fakes.webAssemblyRuntimeSupport,
}))
