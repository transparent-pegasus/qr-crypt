// Transfer-progress state for docs/spec/qr-protocol-v2.md §6. Release chunk state on
// timeout (10-minute default), explicit discard, completion, or error.
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
