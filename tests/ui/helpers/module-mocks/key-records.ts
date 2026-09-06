import { vi } from "vitest"
import * as fakes from "../fakes/key-records"

vi.mock("@/storage/key-repository", () => ({
  listKeyRecords: fakes.listKeyRecords,
  saveKeyRecord: fakes.saveKeyRecord,
  // The two differ only in lock ownership, which this in-memory fake does not model.
  writeKeyRecord: fakes.saveKeyRecord,
  getKeyRecord: fakes.getKeyRecord,
  getActiveKeyRecord: fakes.getActiveKeyRecord,
  saveSymmetricRotation: fakes.saveSymmetricRotation,
  findKeyByFingerprint: fakes.findKeyByFingerprint,
  renameKeyRecord: fakes.renameKeyRecord,
  deleteKeyRecord: fakes.deleteKeyRecord,
  markKeyUsed: fakes.markKeyUsed,
  clearAllKeys: fakes.clearAllKeys,
}))
