import { bench, describe } from "vitest"
import { createNobleDsa87, createNobleKem1024 } from "@/crypto/pq/provider-noble"
import { mlDsaContextV2 } from "@/crypto/pq/wire-bytes"

const kem = createNobleKem1024()
const dsa = createNobleDsa87()
const kemSeed = new Uint8Array(64).fill(0x41)
const dsaSeed = new Uint8Array(32).fill(0x42)
const kemKeys = kem.keygen(kemSeed)
const dsaKeys = dsa.keygen(dsaSeed)
const encapsulated = kem.encapsulate(kemKeys.publicKey)
const message = new TextEncoder().encode("maximum PQ benchmark message")
const context = mlDsaContextV2()
const signature = dsa.sign(message, dsaKeys.secretKey, context)

describe("maximum PQ primitives", () => {
  bench("ML-KEM-1024 keygen", () => {
    void kem.keygen(kemSeed)
  })
  bench("ML-KEM-1024 encapsulate", () => {
    void kem.encapsulate(kemKeys.publicKey)
  })
  bench("ML-KEM-1024 decapsulate", () => {
    void kem.decapsulate(encapsulated.ciphertext, kemKeys.secretKey)
  })
  bench("ML-DSA-87 sign", () => {
    void dsa.sign(message, dsaKeys.secretKey, context)
  })
  bench("ML-DSA-87 verify", () => {
    void dsa.verify(signature, message, dsaKeys.publicKey, context)
  })
})
