import { vi } from "vitest"
import * as fakes from "../fakes/receipts"

vi.mock("@/features/receipt-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/receipt-cache")>()),
  recordReceipt: fakes.recordReceipt,
}))
