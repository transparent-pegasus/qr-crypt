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

// @/crypto/errors は純粋(依存ゼロ)のためモックしない。
// モックすると factory → fakes → errors(モック中)の循環初期化になる。
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
vi.mock("@/crypto/rsa-hybrid", () => ({
  generateRsaKeyPair: fakes.generateRsaKeyPair,
  encryptRsaHybrid: fakes.encryptRsaHybrid,
  decryptRsaHybrid: fakes.decryptRsaHybrid,
}))
vi.mock("@/crypto/key-generation", () => ({
  createSymmetricKeyRecord: fakes.createSymmetricKeyRecord,
  createRsaKeyPairRecord: fakes.createRsaKeyPairRecord,
  importSymmetricKeyRecord: fakes.importSymmetricKeyRecord,
  importPublicKeyRecord: fakes.importPublicKeyRecord,
  buildSymmetricKeyEnvelope: fakes.buildSymmetricKeyEnvelope,
  buildPublicKeyEnvelope: fakes.buildPublicKeyEnvelope,
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
vi.mock("@/storage/qr-repository", () => ({
  listQrArtifacts: fakes.listQrArtifacts,
  saveQrArtifact: fakes.saveQrArtifact,
  findQrByPayloadSha256: fakes.findQrByPayloadSha256,
  renameQrArtifact: fakes.renameQrArtifact,
  deleteQrArtifact: fakes.deleteQrArtifact,
  markQrViewed: fakes.markQrViewed,
  clearAllQrArtifacts: fakes.clearAllQrArtifacts,
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
