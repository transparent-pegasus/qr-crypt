import { cleanup } from "@testing-library/react"
import { afterEach, vi } from "vitest"
import { clearReceipts } from "@/features/receipt-cache"
import { resetDatabaseAccessBarrierForTesting } from "@/storage/database"
import { MemoryStorage } from "../../helpers/memory-storage"

export const localStorage = new MemoryStorage()
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: localStorage,
})

afterEach(() => {
  clearReceipts()
  cleanup()
  window.localStorage.clear()
  resetDatabaseAccessBarrierForTesting()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
