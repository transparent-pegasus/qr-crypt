import { vi } from "vitest"
import { fakeKeys } from "./key-records"
import { fakeBundles, fakeIdentities } from "./pq-records"

export const deleteEntireDatabase = vi.fn(async () => {
  fakeKeys.splice(0)
  fakeIdentities.splice(0)
  fakeBundles.splice(0)
})
export const getDb = vi.fn()
export const closeDb = vi.fn()
