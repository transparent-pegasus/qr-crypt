import { vi } from "vitest"
import * as fakes from "./fakes"

vi.mock("@/lib/feature-detect", () => ({
  detectFeatures: fakes.detectFeatures,
}))

vi.mock("@/lib/bytes", () => ({
  utf8ToBytes: fakes.utf8ToBytes,
  bytesToUtf8: fakes.bytesToUtf8,
  utf8ByteLength: fakes.utf8ByteLength,
  bytesToHex: fakes.bytesToHex,
  concatBytes: fakes.concatBytes,
  bytesEqual: fakes.bytesEqual,
  toOwnedArrayBuffer: fakes.toOwnedArrayBuffer,
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
vi.mock("@/crypto/pq/canonical-cbor", () => ({
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
vi.mock("@/crypto/vault/vault-key", () => ({
  getOrCreateVaultKey: fakes.getOrCreateVaultKey,
  dropVaultKeyCache: vi.fn(),
}))

vi.mock("@/qr/payload", () => ({
  encodeEnvelopeToPayload: fakes.encodeEnvelopeToPayload,
  decodePayload: fakes.decodePayload,
  payloadSha256Hex: fakes.payloadSha256Hex,
}))
vi.mock("@/qr/encode", () => ({
  renderQrDataUrl: fakes.renderQrDataUrl,
  renderQrSvgString: fakes.renderQrSvgString,
  qrByteCapacity: fakes.qrByteCapacity,
  payloadFits: fakes.payloadFits,
  estimatePayloadChars: fakes.estimatePayloadChars,
  ecLevelFor: fakes.ecLevelFor,
}))
vi.mock("@/qr/export-image", () => ({
  qrPngBlob: fakes.qrPngBlob,
  qrSvgBlob: fakes.qrSvgBlob,
  sanitizeQrFileName: fakes.sanitizeQrFileName,
  buildExportFileName: fakes.buildExportFileName,
  triggerDownload: fakes.triggerDownload,
  copyTextToClipboard: fakes.copyTextToClipboard,
}))
vi.mock("@/qr/decode", () => ({
  startQrScan: fakes.startQrScan,
}))
vi.mock("@/qr/multipart/split", () => ({
  splitIntoFrames: fakes.splitIntoFrames,
}))
vi.mock("@/qr/multipart/assemble", () => ({
  TransferAssembler: fakes.FakeTransferAssembler,
}))
vi.mock("@/qr/payload-v2", () => ({
  buildV2Payload: fakes.buildV2Payload,
  splitV2Payload: fakes.splitV2Payload,
  encodeFrameToPayload: fakes.encodeFrameToPayload,
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
  revokeIdentity: fakes.revokeIdentity,
  deleteIdentity: fakes.deleteIdentity,
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
vi.mock("@/storage/preferences-repository", () => ({
  getPreferences: fakes.getPreferences,
  updatePreferences: fakes.updatePreferences,
}))
vi.mock("@/storage/database", () => ({
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
