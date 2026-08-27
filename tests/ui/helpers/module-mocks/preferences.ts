import { vi } from "vitest"
import * as fakes from "../fakes/preferences"

vi.mock("@/storage/preferences-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/storage/preferences-repository")>()),
  defaultPreferences: fakes.defaultPreferences,
  getPreferences: fakes.getPreferences,
  updatePreferences: fakes.updatePreferences,
}))
