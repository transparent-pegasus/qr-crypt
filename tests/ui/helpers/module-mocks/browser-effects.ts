import { vi } from "vitest"
import * as fakes from "../fakes/browser-effects"

vi.mock("@/qr/export-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/export-image")>()),
  qrPngBlob: fakes.qrPngBlob,
  qrSvgBlob: fakes.qrSvgBlob,
  triggerDownload: fakes.triggerDownload,
}))
vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: fakes.copyTextToClipboard,
  copyImageToClipboard: fakes.copyImageToClipboard,
}))
