import { vi } from "vitest"
import * as fakes from "../fakes/qr-scanner"

vi.mock("@/qr/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/decode")>()),
  readerModuleState: fakes.readerModuleState,
  startQrScan: fakes.startQrScan,
  warmQrReader: fakes.warmQrReader,
}))
