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
  encryptWithAesKey: fakes.encryptWithAesKey,
  decryptWithAesKey: fakes.decryptWithAesKey,
}))
vi.mock("@/crypto/key-generation", () => ({
  createSymmetricKeyRecord: fakes.createSymmetricKeyRecord,
  importSymmetricKeyRecord: fakes.importSymmetricKeyRecord,
  buildSymmetricKeyEnvelope: fakes.buildSymmetricKeyEnvelope,
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
vi.mock("@/crypto/pq/canonical-cbor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/crypto/pq/canonical-cbor")>()),
  encodeUnsignedMessageBodyV2: fakes.encodeUnsignedMessageBodyV2,
  encodeSignedMessageV2: fakes.encodeSignedMessageV2,
  encodeMlKemEnvelopeV2: fakes.encodeMlKemEnvelopeV2,
  decodeMlKemEnvelopeV2: fakes.decodeMlKemEnvelopeV2,
  encodePublicIdentityBundleV2: fakes.encodePublicIdentityBundleV2,
  decodePublicIdentityBundleV2: fakes.decodePublicIdentityBundleV2,
  encodeKemPublicKeyEnvelopeV2: fakes.encodeKemPublicKeyEnvelopeV2,
  decodeKemPublicKeyEnvelopeV2: fakes.decodeKemPublicKeyEnvelopeV2,
  encodeDsaPublicKeyEnvelopeV2: fakes.encodeDsaPublicKeyEnvelopeV2,
  decodeDsaPublicKeyEnvelopeV2: fakes.decodeDsaPublicKeyEnvelopeV2,
}))
vi.mock("@/crypto/vault/vault-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/crypto/vault/vault-key")>()),
  getOrCreateVaultKey: fakes.getOrCreateVaultKey,
  dropVaultKeyCache: vi.fn(),
}))

vi.mock("@/qr/payload", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/payload")>()),
  encodeEnvelopeToPayload: fakes.encodeEnvelopeToPayload,
  decodePayload: fakes.decodePayload,
  payloadSha256Hex: fakes.payloadSha256Hex,
}))
vi.mock("@/qr/encode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/encode")>()),
  renderQrDataUrl: fakes.renderQrDataUrl,
  renderQrSvgString: fakes.renderQrSvgString,
  qrByteCapacity: fakes.qrByteCapacity,
  payloadFits: fakes.payloadFits,
  estimatePayloadChars: fakes.estimatePayloadChars,
  ecLevelFor: fakes.ecLevelFor,
  relayMessageEcLevel: fakes.relayMessageEcLevel,
}))
vi.mock("@/qr/export-image", () => ({
  qrPngBlob: fakes.qrPngBlob,
  qrSvgBlob: fakes.qrSvgBlob,
  sanitizeQrFileName: fakes.sanitizeQrFileName,
  buildExportFileName: fakes.buildExportFileName,
  triggerDownload: fakes.triggerDownload,
  copyTextToClipboard: fakes.copyTextToClipboard,
}))
vi.mock("@/qr/export-frames", () => ({
  exportQrFramePayloads: fakes.exportQrFramePayloads,
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
  getKeyRecord: fakes.getKeyRecord,
  findKeyByFingerprint: fakes.findKeyByFingerprint,
  renameKeyRecord: fakes.renameKeyRecord,
  deleteKeyRecord: fakes.deleteKeyRecord,
  markKeyUsed: fakes.markKeyUsed,
  clearAllKeys: fakes.clearAllKeys,
}))
vi.mock("@/storage/pq-identity-repository", () => ({
  listIdentities: fakes.listIdentities,
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
