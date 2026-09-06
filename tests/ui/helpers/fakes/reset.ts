import { vi } from "vitest"

const domainResets = new Set<() => void>()

export function registerFakeReset(reset: () => void): void {
  domainResets.add(reset)
}

export function resetFakes(): void {
  for (const reset of domainResets) reset()
  vi.clearAllMocks()
}
