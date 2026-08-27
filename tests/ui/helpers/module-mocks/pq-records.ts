import { vi } from "vitest"
import * as fakes from "../fakes/pq-records"

vi.mock("@/storage/pq-identity-repository", () => ({
  listIdentities: fakes.listIdentities,
  getIdentity: fakes.getIdentity,
  saveIdentity: fakes.saveIdentity,
  saveRotation: fakes.saveRotation,
  renameIdentity: fakes.renameIdentity,
  revokeIdentity: fakes.revokeIdentity,
  deleteIdentity: fakes.deleteIdentity,
  deleteSupersededIdentities: fakes.deleteSupersededIdentities,
  clearAllIdentities: fakes.clearAllIdentities,
  markIdentityUsed: fakes.markIdentityUsed,
  findIdentityByKemKeyId: fakes.findIdentityByKemKeyId,
}))
vi.mock("@/storage/pq-bundle-repository", () => ({
  listBundles: fakes.listBundles,
  getBundle: fakes.getBundle,
  saveBundle: fakes.saveBundle,
  confirmBundleFingerprint: fakes.confirmBundleFingerprint,
  revokeBundle: fakes.revokeBundle,
  deleteBundle: fakes.deleteBundle,
  markBundleUsed: fakes.markBundleUsed,
  findBundleBySigningKeyId: fakes.findBundleBySigningKeyId,
  findBundleByKemKeyId: fakes.findBundleByKemKeyId,
}))
