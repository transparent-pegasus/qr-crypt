import type { StorableArtifactKind } from "@/schemas/domain"

export interface PendingDelete {
  kind: "identity" | "symmetric"
  id: string
  name: string
}

export interface IdentityQrView {
  kind: "identity-qr"
  targetName: string
  generatedAt: number
  artifactType: StorableArtifactKind
  artifactBytes: Uint8Array
  generation: number
}

interface SymmetricQrView {
  kind: "symmetric-qr"
  payload: string
}

export type DetailView =
  | { kind: "detail" }
  | IdentityQrView
  | SymmetricQrView
