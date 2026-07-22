// PQ プロバイダーインターフェース(spec2 §3 — 同期契約を厳守)。
// 実装は provider-noble.ts のみ(WP-11)。暗号処理を特定パッケージへ直接
// 結合せず、必ず本インターフェース経由で呼び出す。
// 注意: 同期プロバイダーを UI スレッドで実行してはならない(spec2 §4)。
// ブラウザーでは Worker(pq-crypto.worker.ts)内でのみ保持し、
// Node テストのみ直接 import を許可する(plan2.1 §F)。
import type { MlDsaAlgorithm, MlKemAlgorithm } from "@/schemas/domain"

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
  kem768: MlKemProvider
  kem1024: MlKemProvider
  dsa65: MlDsaProvider
  dsa87: MlDsaProvider
}

// env.pqProvider("noble" のみ。未知値は env-schema が起動時に拒否)から解決する。
export function resolveProviders(providerId: "noble"): PqProviders {
  void providerId
  throw new Error("NOT_IMPLEMENTED: WP-11 resolveProviders")
}
