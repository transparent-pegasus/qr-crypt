// PQ provider interface; strictly preserve the synchronous contract.
// provider-noble.ts is the sole implementation. Do not couple cryptographic
// operations directly to a package; always invoke them through this interface.
// Caution: never run the synchronous provider on the UI thread.
// In browsers, hold it only inside the Worker (pq-crypto.worker.ts); only Node tests
// may import it directly.
import type { MlDsaAlgorithm, MlKemAlgorithm } from "@/schemas/domain"
import {
  createNobleDsa87,
  createNobleKem1024,
} from "@/crypto/pq/provider-noble"

export interface MlKemProvider {
  readonly algorithm: MlKemAlgorithm

  keygen(seed?: Uint8Array): {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }

  encapsulate(publicKey: Uint8Array): {
    ciphertext: Uint8Array
    sharedSecret: Uint8Array
  }

  decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array
}

export interface MlDsaProvider {
  readonly algorithm: MlDsaAlgorithm

  keygen(seed?: Uint8Array): {
    publicKey: Uint8Array
    secretKey: Uint8Array
  }

  sign(message: Uint8Array, secretKey: Uint8Array, context: Uint8Array): Uint8Array

  verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
    context: Uint8Array,
  ): boolean
}

export interface PqProviders {
  kem1024: MlKemProvider
  dsa87: MlDsaProvider
}

// Resolve from env.pqProvider ("noble" only; env-schema rejects unknown values at startup).
export function resolveProviders(providerId: "noble"): PqProviders {
  if (providerId !== "noble") throw new TypeError("unsupported PQ provider")
  return Object.freeze({
    kem1024: createNobleKem1024(),
    dsa87: createNobleDsa87(),
  })
}
