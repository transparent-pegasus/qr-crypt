// Transfer-progress state for docs/spec/qr-protocol-v2.md §6. Release chunk state on
// timeout (10-minute default), explicit discard, completion, or error.
import type { ErrorCode } from "@/crypto/errors"
import { bytesEqual } from "@/lib/bytes"
import type { QrFrameV2, V2ArtifactType } from "@/schemas/domain"

export interface FrameTransferMetadata {
  readonly transferId: Uint8Array
  readonly artifactType: V2ArtifactType
  readonly frameCount: number
  readonly totalByteLength: number
}

export function frameMatchesMetadata(
  metadata: FrameTransferMetadata,
  frame: QrFrameV2,
): boolean {
  return (
    bytesEqual(metadata.transferId, frame.transferId) &&
    metadata.artifactType === frame.artifactType &&
    metadata.frameCount === frame.frameCount &&
    metadata.totalByteLength === frame.totalByteLength
  )
}

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
