import { vi } from "vitest"
import { AppError } from "@/crypto/errors"
import type {
  PostQuantumIdentity,
  PqPublicBundleRecord,
} from "@/schemas/domain"
import { defaultIdentity, recordFromIdentity } from "./pq-fixtures"
import { registerFakeReset } from "./reset"

export const fakeIdentities: PostQuantumIdentity[] = [defaultIdentity()]
export const fakeBundles: PqPublicBundleRecord[] = [
  recordFromIdentity(fakeIdentities[0]!),
]

export const renameIdentity = vi.fn(async (id: string, name: string) => {
  const existing = fakeIdentities.find((identity) => identity.id === id)
  if (existing === undefined || existing.status === "rotated") {
    throw new AppError("KEY_NOT_FOUND")
  }
  existing.name = name.trim()
})
export const findIdentityByKemKeyId = vi.fn(async (keyId: string) =>
  fakeIdentities.find((identity) => identity.kem.keyId === keyId),
)
export const listIdentities = vi.fn(async () => [...fakeIdentities])
export const getIdentity = vi.fn(async (id: string) =>
  fakeIdentities.find((identity) => identity.id === id),
)
export const saveIdentity = vi.fn(async (identity: PostQuantumIdentity) => {
  fakeIdentities.unshift(identity)
})
export const saveRotation = vi.fn(
  async ({
    next,
    previous,
  }: {
    next: PostQuantumIdentity
    previous: PostQuantumIdentity
  }) => {
    const index = fakeIdentities.findIndex(
      (identity) => identity.id === previous.id,
    )
    if (index >= 0) fakeIdentities[index] = previous
    fakeIdentities.unshift(next)
  },
)
export const revokeIdentity = vi.fn(async (id: string, revokedAt: number) => {
  const index = fakeIdentities.findIndex((identity) => identity.id === id)
  if (index >= 0) {
    fakeIdentities[index] = {
      ...fakeIdentities[index]!,
      status: "revoked",
      revokedAt,
    }
  }
})
export const deleteIdentity = vi.fn(async (id: string) => {
  const index = fakeIdentities.findIndex((identity) => identity.id === id)
  if (index >= 0) fakeIdentities.splice(index, 1)
})
export const deleteSupersededIdentities = vi.fn(
  async (ids: readonly string[]) => {
    const requested = new Set(ids)
    const present = fakeIdentities.filter((identity) =>
      requested.has(identity.id),
    )
    if (present.some((identity) => identity.status === "active")) {
      throw new AppError("STORAGE_FAILED")
    }
    const presentIds = new Set(present.map((identity) => identity.id))
    for (let index = fakeIdentities.length - 1; index >= 0; index -= 1) {
      if (presentIds.has(fakeIdentities[index]!.id)) {
        fakeIdentities.splice(index, 1)
      }
    }
  },
)
export const clearAllIdentities = vi.fn(async () => {
  fakeIdentities.splice(0)
})
export const markIdentityUsed = vi.fn(async () => undefined)

export const listBundles = vi.fn(async () => [...fakeBundles])
export const getBundle = vi.fn(async (recordId: string) =>
  fakeBundles.find((record) => record.recordId === recordId),
)
export const saveBundle = vi.fn(async (record: PqPublicBundleRecord) => {
  fakeBundles.unshift(record)
})
export const confirmBundleFingerprint = vi.fn(
  async (recordId: string, when: number) => {
    const index = fakeBundles.findIndex((record) => record.recordId === recordId)
    if (index >= 0) {
      fakeBundles[index] = {
        ...fakeBundles[index]!,
        trust: "fingerprint-confirmed",
        trustConfirmedAt: when,
      }
    }
  },
)
export const revokeBundle = vi.fn(
  async (recordId: string, revokedAt: number) => {
    const index = fakeBundles.findIndex((record) => record.recordId === recordId)
    if (index >= 0) {
      fakeBundles[index] = { ...fakeBundles[index]!, revokedAt }
    }
  },
)
export const deleteBundle = vi.fn(async (recordId: string) => {
  const index = fakeBundles.findIndex((record) => record.recordId === recordId)
  if (index >= 0) fakeBundles.splice(index, 1)
})
export const markBundleUsed = vi.fn(async () => undefined)

async function defaultFindBundleBySigningKeyId(keyId: string) {
  return fakeBundles.find(
    (record) =>
      record.signing.keyId === keyId && record.revokedAt === undefined,
  )
}

async function defaultFindBundleByKemKeyId(keyId: string) {
  return fakeBundles.find(
    (record) => record.kem.keyId === keyId && record.revokedAt === undefined,
  )
}

export const findBundleBySigningKeyId = vi.fn(
  defaultFindBundleBySigningKeyId,
)
export const findBundleByKemKeyId = vi.fn(defaultFindBundleByKemKeyId)

registerFakeReset(() => {
  const identity = defaultIdentity()
  fakeIdentities.splice(0, fakeIdentities.length, identity)
  fakeBundles.splice(
    0,
    fakeBundles.length,
    recordFromIdentity(identity),
  )
  findBundleBySigningKeyId.mockImplementation(
    defaultFindBundleBySigningKeyId,
  )
  findBundleByKemKeyId.mockImplementation(defaultFindBundleByKemKeyId)
})
