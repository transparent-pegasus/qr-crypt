import { bench, describe } from "vitest"
import { createNobleDsa65, createNobleKem768 } from "@/crypto/pq/provider-noble"
import { mlDsaContextV2 } from "@/crypto/pq/wire-bytes"

const kem = createNobleKem768()
const dsa = createNobleDsa65()
const kemSeed = new Uint8Array(64).fill(0x41)
const dsaSeed = new Uint8Array(32).fill(0x42)
const kemKeys = kem.keygen(kemSeed)
const dsaKeys = dsa.keygen(dsaSeed)
const encapsulated = kem.encapsulate(kemKeys.publicKey)
const message = new TextEncoder().encode("balanced PQ benchmark message")
const context = mlDsaContextV2()
const signature = dsa.sign(message, dsaKeys.secretKey, context)

describe("balanced PQ primitives", () => {
  bench("ML-KEM-768 keygen", () => {
    void kem.keygen(kemSeed)
  })
  bench("ML-KEM-768 encapsulate", () => {
    void kem.encapsulate(kemKeys.publicKey)
  })
  bench("ML-KEM-768 decapsulate", () => {
    void kem.decapsulate(encapsulated.ciphertext, kemKeys.secretKey)
  })
  bench("ML-DSA-65 sign", () => {
    void dsa.sign(message, dsaKeys.secretKey, context)
  })
  bench("ML-DSA-65 verify", () => {
    void dsa.verify(signature, message, dsaKeys.publicKey, context)
  })
})
