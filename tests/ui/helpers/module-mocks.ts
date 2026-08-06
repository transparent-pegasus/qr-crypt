import { vi } from "vitest"
import * as fakes from "./fakes"

// Spread the original so newly-canonical exports (isStandalone) stay real:
// before it moved here each caller read window.matchMedia directly, and these
// suites depend on that real read.
vi.mock("@/lib/feature-detect", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/feature-detect")>()),
  detectFeatures: fakes.detectFeatures,
  probeWebAssemblyRuntime: fakes.probeWebAssemblyRuntime,
  webAssemblyRuntimeSupport: fakes.webAssemblyRuntimeSupport,
}))

// Pure synchronous helpers run for real; only the WebCrypto digests are faked, because
// UI assertions depend on the fake's deterministic fingerprint values.
vi.mock("@/lib/bytes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bytes")>()),
  sha256: fakes.sha256,
  sha256Hex: fakes.sha256Hex,
}))

// @/crypto/errors is pure (dependency-free), so do not mock it.
// Mocking it creates a circular factory → fakes → errors (while mocked) initialization.
vi.mock("@/crypto/random", () => ({
  generateArtifactId: fakes.generateArtifactId,
  generateKeyId: fakes.generateKeyId,
  shortId: fakes.shortId,
  randomBytes: fakes.randomBytes,
}))
vi.mock("@/crypto/aes-gcm", () => ({
  generateAesKey: fakes.generateAesKey,
  sealSymMessage: fakes.sealSymMessage,
  openSymMessage: fakes.openSymMessage,
}))
vi.mock("@/crypto/key-generation", () => ({
  createSymmetricKeyRecord: fakes.createSymmetricKeyRecord,
  importSymmetricKeyRecordV2: fakes.importSymmetricKeyRecordV2,
  buildSymmetricKeyEnvelopeV2: fakes.buildSymmetricKeyEnvelopeV2,
  rotateSymmetricKeyRecord: fakes.rotateSymmetricKeyRecord,
}))
vi.mock("@/crypto/pq/worker-client", () => ({
  createPqCryptoClient: fakes.createPqCryptoClient,
}))
vi.mock("@/crypto/pq/identity", () => ({
  createIdentity: fakes.createIdentity,
  rotateIdentity: fakes.rotateIdentity,
  buildPublicBundle: fakes.buildPublicBundle,
}))
vi.mock("@/crypto/pq/ml-kem-envelope", () => ({
  encryptPq: fakes.encryptPq,
}))
vi.mock("@/crypto/pq/decrypt-orchestrator", () => ({
  decryptPqMessage: fakes.decryptPqMessage,
}))
vi.mock("@/crypto/pq/wire-bytes", () => ({
  pqKeyFingerprint: fakes.pqKeyFingerprint,
  pqIdentityFingerprint: fakes.pqIdentityFingerprint,
}))
vi.mock("@/crypto/pq/canonical-cbor", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/crypto/pq/canonical-cbor")>()
  fakes.encodeSymmetricKeyEnvelopeV2.mockImplementation(
    original.encodeSymmetricKeyEnvelopeV2,
  )
  fakes.decodeSymmetricKeyEnvelopeV2.mockImplementation(
    original.decodeSymmetricKeyEnvelopeV2,
  )
  return {
    ...original,
    encodeUnsignedMessageBodyV2: fakes.encodeUnsignedMessageBodyV2,
    encodeSignedMessageV2: fakes.encodeSignedMessageV2,
    encodeMlKemEnvelopeV2: fakes.encodeMlKemEnvelopeV2,
    decodeMlKemEnvelopeV2: fakes.decodeMlKemEnvelopeV2,
    encodeSymMessageEnvelopeV2: fakes.encodeSymMessageEnvelopeV2,
    decodeSymMessageEnvelopeV2: fakes.decodeSymMessageEnvelopeV2,
    encodeSymmetricKeyEnvelopeV2: fakes.encodeSymmetricKeyEnvelopeV2,
    decodeSymmetricKeyEnvelopeV2: fakes.decodeSymmetricKeyEnvelopeV2,
    encodePublicIdentityBundleV2: fakes.encodePublicIdentityBundleV2,
    decodePublicIdentityBundleV2: fakes.decodePublicIdentityBundleV2,
  }
})
vi.mock("@/crypto/vault/vault-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/crypto/vault/vault-key")>()),
  getOrCreateVaultKey: fakes.getOrCreateVaultKey,
  dropVaultKeyCache: vi.fn(),
}))

vi.mock("@/qr/payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/payload")>()),
  decodePayload: fakes.decodePayload,
  payloadSha256Hex: fakes.payloadSha256Hex,
}))
// Capacity, filename, and frame-set export run for real; only rendering and the
// browser effects (blob creation, download) are faked. The real export loop
// reaches those fakes through its own import of @/qr/export-image, so a test
// that needs an export to fail or hang injects at qrPngBlob — never by mocking
// the exporter, which is what let a second copy of it drift here before.
vi.mock("@/qr/encode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/encode")>()),
  renderQrDataUrl: fakes.renderQrDataUrl,
  renderQrSvgString: fakes.renderQrSvgString,
}))
vi.mock("@/qr/export-image", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/export-image")>()),
  qrPngBlob: fakes.qrPngBlob,
  qrSvgBlob: fakes.qrSvgBlob,
  triggerDownload: fakes.triggerDownload,
}))
vi.mock("@/lib/clipboard", () => ({
  copyTextToClipboard: fakes.copyTextToClipboard,
}))
vi.mock("@/qr/decode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/decode")>()),
  readerModuleState: fakes.readerModuleState,
  startQrScan: fakes.startQrScan,
  warmQrReader: fakes.warmQrReader,
}))
vi.mock("@/qr/multipart/split", () => ({
  splitIntoFrames: fakes.splitIntoFrames,
}))
vi.mock("@/qr/multipart/assemble", () => ({
  TransferAssembler: fakes.FakeTransferAssembler,
}))

vi.mock("@/features/receipt-cache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/features/receipt-cache")>()),
  recordReceipt: fakes.recordReceipt,
}))

vi.mock("@/storage/key-repository", () => ({
  listKeyRecords: fakes.listKeyRecords,
  saveKeyRecord: fakes.saveKeyRecord,
  // The two differ only in who requests the sensitive-write lock, which nothing
  // in this fake layer models; tests/integration/storage.test.ts owns that.
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
vi.mock("@/storage/preferences-repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/storage/preferences-repository")>()),
  defaultPreferences: fakes.defaultPreferences,
  getPreferences: fakes.getPreferences,
  updatePreferences: fakes.updatePreferences,
}))
vi.mock("@/storage/database", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/storage/database")>()),
  getDb: fakes.getDb,
  closeDb: fakes.closeDb,
  deleteEntireDatabase: fakes.deleteEntireDatabase,
}))

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: fakes.useFakeRegisterSW,
}))
vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: fakes.useFakeRegisterSW,
}))

vi.mock("@/app/boot/boot-controller", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/app/boot/boot-controller")>()),
  armMaintenanceToken: fakes.armMaintenanceToken,
}))
