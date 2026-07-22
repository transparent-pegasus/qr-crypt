// @noble/post-quantum 0.6.1 アダプター(WP-11)。exact pin(範囲指定禁止 spec2 §20)。
// noble API(0.6.1): ml_kem768/1024.keygen(seed64?) / .encapsulate(pk) /
// .decapsulate(ct, sk)、ml_dsa65/87.keygen(seed32?) / .sign(msg, sk, { context })
// / .verify(sig, msg, pk, { context })。context は opts へマップする。
// 入出力長は profiles.ts の定数表と一致すること(アダプター側で検証する)。
import type { MlDsaProvider, MlKemProvider } from "@/crypto/pq/provider"

export function createNobleKem768(): MlKemProvider {
  throw new Error("NOT_IMPLEMENTED: WP-11 provider-noble kem768")
}

export function createNobleKem1024(): MlKemProvider {
  throw new Error("NOT_IMPLEMENTED: WP-11 provider-noble kem1024")
}

export function createNobleDsa65(): MlDsaProvider {
  throw new Error("NOT_IMPLEMENTED: WP-11 provider-noble dsa65")
}

export function createNobleDsa87(): MlDsaProvider {
  throw new Error("NOT_IMPLEMENTED: WP-11 provider-noble dsa87")
}
