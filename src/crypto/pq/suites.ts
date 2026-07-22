// v2 suite 導出(plan2.1 §C1 — WP-A2 が実装・凍結)。
// suite は preference ではなく「選択済み鍵の実 algorithm の組」から一意導出する。
// UI profile は候補の filter/default にだけ使う。
import type { MlDsaAlgorithm, MlKemAlgorithm, WireSuite } from "@/schemas/domain"
import { AppError } from "@/crypto/errors"

// 許可される署名付き組は (768,65) / (1024,87) のみ。
// 768+87 等の混在は型混同/downgrade として拒否する。
export function resolveSuite(
  kem: MlKemAlgorithm,
  signature?: MlDsaAlgorithm,
): WireSuite {
  if (kem === "ML-KEM-768") {
    if (signature === undefined) return "ML-KEM-768+HKDF-SHA256+A256GCM"
    if (signature === "ML-DSA-65") {
      return "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM"
    }
    throw new AppError("UNSUPPORTED_ALGORITHM")
  }
  if (signature === undefined) return "ML-KEM-1024+HKDF-SHA256+A256GCM"
  if (signature === "ML-DSA-87") {
    return "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM"
  }
  throw new AppError("UNSUPPORTED_ALGORITHM")
}

export interface SuiteComponents {
  kem: MlKemAlgorithm
  signature?: MlDsaAlgorithm
}

// 復号側の相互拘束(plan2.1 §C4)用の逆引き。resolveSuite と往復一致すること。
export function suiteComponents(suite: WireSuite): SuiteComponents {
  switch (suite) {
    case "ML-KEM-768+HKDF-SHA256+A256GCM":
      return { kem: "ML-KEM-768" }
    case "ML-KEM-768+ML-DSA-65+HKDF-SHA256+A256GCM":
      return { kem: "ML-KEM-768", signature: "ML-DSA-65" }
    case "ML-KEM-1024+HKDF-SHA256+A256GCM":
      return { kem: "ML-KEM-1024" }
    case "ML-KEM-1024+ML-DSA-87+HKDF-SHA256+A256GCM":
      return { kem: "ML-KEM-1024", signature: "ML-DSA-87" }
  }
}
