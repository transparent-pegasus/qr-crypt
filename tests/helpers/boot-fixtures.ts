import { vi } from "vitest"
import type { BootDecisionSnapshot } from "@/app/boot/boot-controller"

export function response(body: string, status = 200): Response {
  return { status, text: vi.fn(async () => body) } as unknown as Response
}

export function decision(
  overrides: Partial<BootDecisionSnapshot> = {},
): BootDecisionSnapshot {
  const snapshot = {
    wipeOnOnline: true,
    sensitiveDataExists: false,
    maintenanceTokenArmed: false,
    resetChurnMb: 0,
    preferencesReadFailed: false,
    ...overrides,
  }
  return {
    ...snapshot,
    cleanOrigin:
      overrides.cleanOrigin ??
      (snapshot.sensitiveDataExists ? "dirty" : "confirmed-clean"),
  }
}
