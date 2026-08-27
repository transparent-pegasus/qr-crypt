import { vi } from "vitest"
import { AppError } from "@/crypto/errors"
import type { StoredKeyRecord } from "@/schemas/domain"
import { defaultKeys } from "./key-fixtures"
import { registerFakeReset } from "./reset"

export const fakeKeys: StoredKeyRecord[] = defaultKeys()

export const listKeyRecords = vi.fn(async () => [...fakeKeys])
export const saveKeyRecord = vi.fn(async (record: StoredKeyRecord) => {
  if (fakeKeys.some((item) => item.fingerprint === record.fingerprint)) {
    throw new AppError("DUPLICATE_KEY")
  }
  fakeKeys.unshift(record)
})
export const getKeyRecord = vi.fn(async (id: string) =>
  fakeKeys.find((record) => record.id === id),
)
async function defaultGetActiveKeyRecord(
  id: string,
): Promise<StoredKeyRecord | undefined> {
  const record = fakeKeys.find((item) => item.id === id)
  return record?.status === "active" ? record : undefined
}
export const getActiveKeyRecord = vi.fn(defaultGetActiveKeyRecord)
async function defaultSaveSymmetricRotation({
  next,
  previous,
}: {
  next: StoredKeyRecord
  previous: StoredKeyRecord
}): Promise<void> {
  const index = fakeKeys.findIndex((item) => item.id === previous.id)
  const persisted = fakeKeys[index]
  if (
    persisted === undefined ||
    persisted.status !== "active" ||
    persisted.fingerprint !== previous.fingerprint
  ) {
    throw new AppError("STORAGE_FAILED")
  }
  fakeKeys[index] = previous
  fakeKeys.unshift(next)
}
export const saveSymmetricRotation = vi.fn(defaultSaveSymmetricRotation)
export const findKeyByFingerprint = vi.fn(async (fingerprint: string) =>
  fakeKeys.find((record) => record.fingerprint === fingerprint),
)
export const renameKeyRecord = vi.fn(async (id: string, name: string) => {
  const record = fakeKeys.find((item) => item.id === id)
  if (record) record.name = name
})
export const deleteKeyRecord = vi.fn(async (id: string) => {
  const index = fakeKeys.findIndex((item) => item.id === id)
  if (index >= 0) fakeKeys.splice(index, 1)
})
export const markKeyUsed = vi.fn(async (id: string, when: number) => {
  const record = fakeKeys.find((item) => item.id === id)
  if (record) {
    record.useCount += 1
    record.lastUsedAt = when
  }
})
export const clearAllKeys = vi.fn(async () => {
  fakeKeys.splice(0)
})

registerFakeReset(() => {
  fakeKeys.splice(0, fakeKeys.length, ...defaultKeys())
  getActiveKeyRecord.mockImplementation(defaultGetActiveKeyRecord)
  saveSymmetricRotation.mockImplementation(defaultSaveSymmetricRotation)
})
