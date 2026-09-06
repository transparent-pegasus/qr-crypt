import { vi } from "vitest"
import * as fakes from "../fakes/crypto-runtime"

// Pure synchronous byte helpers remain real; deterministic digest fakes avoid
// coupling UI assertions to WebCrypto.
vi.mock("@/lib/bytes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bytes")>()),
  sha256: fakes.sha256,
  sha256Hex: fakes.sha256Hex,
}))
vi.mock("@/crypto/random", () => ({
  generateArtifactId: fakes.generateArtifactId,
  generateKeyId: fakes.generateKeyId,
  shortId: fakes.shortId,
  randomBytes: fakes.randomBytes,
}))
vi.mock("@/crypto/vault/vault-key", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/crypto/vault/vault-key")>()),
  getOrCreateVaultKey: fakes.getOrCreateVaultKey,
  dropVaultKeyCache: vi.fn(),
}))
