import { describe, expect, it } from "vitest"
import {
  createNobleDsa65,
  createNobleDsa87,
  createNobleKem768,
  createNobleKem1024,
} from "@/crypto/pq/provider-noble"
import type { MlDsaProvider, MlKemProvider } from "@/crypto/pq/provider"
import { fromBase64Url } from "@/lib/base64url"
import { concatBytes, sha256Hex, utf8ToBytes } from "@/lib/bytes"
import {
  ACVP_DSA_EXTERNAL_VERIFY,
  ACVP_DSA_KEYGEN,
  ACVP_KEM_DECAP,
  ACVP_KEM_KEYGEN,
} from "./acvp-fixtures"

function kemProvider(algorithm: "ML-KEM-768" | "ML-KEM-1024"): MlKemProvider {
  return algorithm === "ML-KEM-768" ? createNobleKem768() : createNobleKem1024()
}

function dsaProvider(algorithm: "ML-DSA-65" | "ML-DSA-87"): MlDsaProvider {
  return algorithm === "ML-DSA-65" ? createNobleDsa65() : createNobleDsa87()
}

describe("NIST ACVP ML-KEM projections", () => {
  for (const vector of ACVP_KEM_KEYGEN) {
    it(`${vector.algorithm} keygen tcId=${vector.tcId}`, async () => {
      const generated = kemProvider(vector.algorithm).keygen(fromBase64Url(vector.seed))
      expect(await sha256Hex(generated.publicKey)).toBe(vector.publicKeySha256)
      expect(await sha256Hex(generated.secretKey)).toBe(vector.secretKeySha256)
    })
  }

  for (const vector of ACVP_KEM_DECAP) {
    it(`${vector.algorithm} ${vector.kind} decapsulation tcId=${vector.tcId}`, async () => {
      const secretKey = fromBase64Url(vector.secretKey)
      const ciphertext = fromBase64Url(vector.ciphertext)
      const expected = fromBase64Url(vector.sharedSecret)
      const actual = kemProvider(vector.algorithm).decapsulate(ciphertext, secretKey)
      expect(actual).toEqual(expected)
      expect(
        await sha256Hex(
          concatBytes(secretKey, ciphertext, expected, utf8ToBytes(vector.reason)),
        ),
      ).toBe(vector.projectionSha256)
      expect(vector.reason).toBe(
        vector.kind === "valid" ? "valid decapsulation" : "modified ciphertext",
      )
    })
  }
})

describe("NIST ACVP ML-DSA projections", () => {
  for (const vector of ACVP_DSA_KEYGEN) {
    it(`${vector.algorithm} keygen tcId=${vector.tcId}`, async () => {
      const generated = dsaProvider(vector.algorithm).keygen(fromBase64Url(vector.seed))
      expect(await sha256Hex(generated.publicKey)).toBe(vector.publicKeySha256)
      expect(await sha256Hex(generated.secretKey)).toBe(vector.secretKeySha256)
    })
  }

  // ACVP internal signature inputs are not the public {context} API. These fixtures
  // deliberately use ACVP's external pure interface instead, with non-empty context,
  // and still exercise only the production provider adapter surface.
  for (const vector of ACVP_DSA_EXTERNAL_VERIFY) {
    it(`${vector.algorithm} external ${vector.valid ? "positive" : "negative"} tcId=${vector.tcId}`, async () => {
      const publicKey = fromBase64Url(vector.publicKey)
      const message = fromBase64Url(vector.message)
      const context = fromBase64Url(vector.context)
      const signature = fromBase64Url(vector.signature)
      expect(context.byteLength).toBeGreaterThan(0)
      expect(
        dsaProvider(vector.algorithm).verify(signature, message, publicKey, context),
      ).toBe(vector.valid)
      expect(
        await sha256Hex(
          concatBytes(
            publicKey,
            message,
            context,
            signature,
            Uint8Array.of(vector.valid ? 1 : 0),
          ),
        ),
      ).toBe(vector.projectionSha256)
    })
  }
})
