import { vi } from "vitest"
import * as fakes from "../fakes/boot"

vi.mock("@/app/boot/boot-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/boot/boot-controller")>()),
  armMaintenanceToken: fakes.armMaintenanceToken,
}))
