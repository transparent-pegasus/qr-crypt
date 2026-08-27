import { vi } from "vitest"
import * as fakes from "../fakes/qr-scanner"

vi.mock("@/qr/camera-scan", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/camera-scan")>()),
  readerModuleState: fakes.readerModuleState,
  startQrScan: fakes.startQrScan,
  warmQrReader: fakes.warmQrReader,
}))
