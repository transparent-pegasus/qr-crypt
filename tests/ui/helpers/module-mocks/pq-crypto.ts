import { vi } from "vitest"
import * as fakes from "../fakes/pq-crypto"

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
