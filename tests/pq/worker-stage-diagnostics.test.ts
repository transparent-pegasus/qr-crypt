// The worker collapses every failure into one public code per operation, so a
// failing CI run cannot say which stage of generateIdentityKeys broke. These
// tests pin the stage diagnostic that fills that gap, and pin that it stays
// inside the allowlist docs/security/security-review.md sets for every surface, console
// included: no message, no stack, no cause, no payload, no byte array.
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { createPqCryptoClient, type PqCryptoClient } from "@/crypto/pq/worker-client"
import { dropVaultKeyCache, getOrCreateVaultKey } from "@/crypto/vault/vault-key"
import { closeDb, deleteEntireDatabase } from "@/storage/database"
import { toBase64Url } from "@/lib/base64url"

const clients = new Set<PqCryptoClient>()

function keyId(fill: number): string {
  return toBase64Url(new Uint8Array(16).fill(fill))
}

function client(): PqCryptoClient {
  const value = createPqCryptoClient()
  clients.add(value)
  return value
}

async function generate(pq: PqCryptoClient): Promise<unknown> {
  return pq.generateIdentityKeys({
    profile: "maximum",
    vaultKey: await getOrCreateVaultKey(),
    identityId: keyId(31),
    kemKeyId: keyId(32),
    signingKeyId: keyId(33),
  })
}

let consoleError: MockInstance<typeof console.error>

beforeEach(() => {
  consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined)
})

afterEach(async () => {
  consoleError.mockRestore()
  vi.restoreAllMocks()
  for (const pq of clients) pq.dispose()
  clients.clear()
  dropVaultKeyCache()
  closeDb()
  await deleteEntireDatabase()
})

describe("generateIdentityKeys stage diagnostics", () => {
  it("names the failing stage without leaking the underlying error", async () => {
    const secret = "seed-encryption-boom"
    vi.spyOn(crypto.subtle, "encrypt").mockRejectedValue(
      new DOMException(secret, "OperationError"),
    )

    await expect(generate(client())).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
    })

    const reports = consoleError.mock.calls.filter(
      (call) => call[0] === "[pq-worker-stage]",
    )
    expect(reports).toEqual([
      ["[pq-worker-stage]", "generateIdentityKeys", "seed-encryption", "AppError:ENCRYPTION_FAILED"],
    ])
    // encryptSecret sanitizes before this frame sees it, so the DOMException
    // message must not survive anywhere in the diagnostic.
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain(secret)
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("OperationError")
  })

  it("names the digest stage and keeps the public code unchanged", async () => {
    vi.spyOn(crypto.subtle, "digest").mockRejectedValue(
      new DOMException("digest-boom", "OperationError"),
    )

    await expect(generate(client())).rejects.toMatchObject({
      code: "ENCRYPTION_FAILED",
    })

    expect(
      consoleError.mock.calls.filter((call) => call[0] === "[pq-worker-stage]"),
    ).toEqual([
      [
        "[pq-worker-stage]",
        "generateIdentityKeys",
        "public-key-digest",
        "OperationError",
      ],
    ])
  })

  it("stays silent when the operation succeeds", async () => {
    await generate(client())
    expect(
      consoleError.mock.calls.filter((call) => call[0] === "[pq-worker-stage]"),
    ).toEqual([])
  })
})
