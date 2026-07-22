// 転送進捗の状態型(spec2 §12、plan2.1 §D4/§D5 — 型は WP-A2 凍結、
// 遷移ロジックは WP-12)。タイムアウト(既定 10 分)・明示破棄・完成・
// エラーで chunk state を解放する。
import type { ErrorCode } from "@/crypto/errors"
import type { V2ArtifactType } from "@/schemas/domain"

export type TransferState =
  | { kind: "idle" }
  | {
      kind: "collecting"
      transferId: Uint8Array
      artifactType: V2ArtifactType
      frameCount: number
      receivedIndexes: ReadonlySet<number>
      missingIndexes: readonly number[]
      expiresAt: number
    }
  | {
      kind: "complete"
      transferId: Uint8Array
      artifactType: V2ArtifactType
      artifactBytes: Uint8Array
    }
  | { kind: "error"; code: ErrorCode }
