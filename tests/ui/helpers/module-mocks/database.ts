import { vi } from "vitest"
import * as fakes from "../fakes/database"

vi.mock("@/storage/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/storage/database")>()),
  getDb: fakes.getDb,
  closeDb: fakes.closeDb,
  deleteEntireDatabase: fakes.deleteEntireDatabase,
}))
