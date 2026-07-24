// @noble/post-quantum 0.6.1 adapter. The dependency must remain exactly pinned.
// noble API(0.6.1): ml_kem768/1024.keygen(seed64?) / .encapsulate(pk) /
// .decapsulate(ct, sk), ml_dsa65/87.keygen(seed32?) / .sign(msg, sk, { context })
// / .verify(sig, msg, pk, { context }). Map context into opts.
// Input and output lengths must match the constant table in profiles.ts; the adapter verifies them.
import type { MlDsaProvider, MlKemProvider } from "@/crypto/pq/provider"
import { DSA_SIZES, KEM_SIZES } from "@/crypto/pq/profiles"
import type { MlDsaAlgorithm, MlKemAlgorithm } from "@/schemas/domain"
import { ml_kem768, ml_kem1024 } from "@noble/post-quantum/ml-kem.js"
import { ml_dsa65, ml_dsa87 } from "@noble/post-quantum/ml-dsa.js"

interface NobleKem {
  keygen(seed?: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array }
  encapsulate(publicKey: Uint8Array): {
    cipherText: Uint8Array
    sharedSecret: Uint8Array
  }
  decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array): Uint8Array
}

interface NobleDsa {
  keygen(seed?: Uint8Array): { publicKey: Uint8Array; secretKey: Uint8Array }
  sign(
    message: Uint8Array,
    secretKey: Uint8Array,
    options: { context: Uint8Array },
  ): Uint8Array
  verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
    options: { context: Uint8Array },
  ): boolean
}

function isUint8Array(value: unknown): value is Uint8Array {
  return (
    ArrayBuffer.isView(value) &&
    Object.prototype.toString.call(value) === "[object Uint8Array]"
  )
}

function assertBytes(value: Uint8Array, expected: number, label: string): void {
  if (!isUint8Array(value) || value.byteLength !== expected) {
    throw new RangeError(`${label} length`)
  }
}

function assertMessage(value: Uint8Array, label: string): void {
  if (!isUint8Array(value)) throw new TypeError(label)
}

function ownedBytes(value: Uint8Array, sensitive = false): Uint8Array {
  if (
    value.buffer instanceof ArrayBuffer &&
    value.byteOffset === 0 &&
    value.byteLength === value.buffer.byteLength
  ) {
    return value
  }
  const owned = Uint8Array.from(value)
  if (sensitive) value.fill(0)
  return owned
}

function createKem(algorithm: MlKemAlgorithm, noble: NobleKem): MlKemProvider {
  const sizes = KEM_SIZES[algorithm]
  return Object.freeze({
    algorithm,
    keygen(seed?: Uint8Array) {
      if (seed !== undefined) assertBytes(seed, sizes.seedBytes, "KEM seed")
      const generated = noble.keygen(seed)
      assertBytes(generated.publicKey, sizes.publicKeyBytes, "KEM public key output")
      assertBytes(generated.secretKey, sizes.secretKeyBytes, "KEM secret key output")
      return {
        publicKey: ownedBytes(generated.publicKey),
        secretKey: ownedBytes(generated.secretKey, true),
      }
    },
    encapsulate(publicKey: Uint8Array) {
      assertBytes(publicKey, sizes.publicKeyBytes, "KEM public key")
      const encapsulated = noble.encapsulate(publicKey)
      assertBytes(encapsulated.cipherText, sizes.ciphertextBytes, "KEM ciphertext output")
      assertBytes(
        encapsulated.sharedSecret,
        sizes.sharedSecretBytes,
        "KEM shared secret output",
      )
      return {
        ciphertext: ownedBytes(encapsulated.cipherText),
        sharedSecret: ownedBytes(encapsulated.sharedSecret, true),
      }
    },
    decapsulate(ciphertext: Uint8Array, secretKey: Uint8Array) {
      assertBytes(ciphertext, sizes.ciphertextBytes, "KEM ciphertext")
      assertBytes(secretKey, sizes.secretKeyBytes, "KEM secret key")
      const sharedSecret = noble.decapsulate(ciphertext, secretKey)
      assertBytes(sharedSecret, sizes.sharedSecretBytes, "KEM shared secret output")
      return ownedBytes(sharedSecret, true)
    },
  })
}

function createDsa(algorithm: MlDsaAlgorithm, noble: NobleDsa): MlDsaProvider {
  const sizes = DSA_SIZES[algorithm]
  return Object.freeze({
    algorithm,
    keygen(seed?: Uint8Array) {
      if (seed !== undefined) assertBytes(seed, sizes.seedBytes, "DSA seed")
      const generated = noble.keygen(seed)
      assertBytes(generated.publicKey, sizes.publicKeyBytes, "DSA public key output")
      assertBytes(generated.secretKey, sizes.secretKeyBytes, "DSA secret key output")
      return {
        publicKey: ownedBytes(generated.publicKey),
        secretKey: ownedBytes(generated.secretKey, true),
      }
    },
    sign(message: Uint8Array, secretKey: Uint8Array, context: Uint8Array) {
      assertMessage(message, "DSA message")
      assertBytes(secretKey, sizes.secretKeyBytes, "DSA secret key")
      assertMessage(context, "DSA context")
      if (context.byteLength > 255) throw new RangeError("DSA context length")
      const signature = noble.sign(message, secretKey, { context })
      assertBytes(signature, sizes.signatureBytes, "DSA signature output")
      return ownedBytes(signature)
    },
    verify(
      signature: Uint8Array,
      message: Uint8Array,
      publicKey: Uint8Array,
      context: Uint8Array,
    ) {
      assertBytes(signature, sizes.signatureBytes, "DSA signature")
      assertMessage(message, "DSA message")
      assertBytes(publicKey, sizes.publicKeyBytes, "DSA public key")
      assertMessage(context, "DSA context")
      if (context.byteLength > 255) throw new RangeError("DSA context length")
      try {
        return noble.verify(signature, message, publicKey, { context })
      } catch {
        return false
      }
    },
  })
}

export function createNobleKem768(): MlKemProvider {
  return createKem("ML-KEM-768", ml_kem768)
}

export function createNobleKem1024(): MlKemProvider {
  return createKem("ML-KEM-1024", ml_kem1024)
}

export function createNobleDsa65(): MlDsaProvider {
  return createDsa("ML-DSA-65", ml_dsa65)
}

export function createNobleDsa87(): MlDsaProvider {
  return createDsa("ML-DSA-87", ml_dsa87)
}
