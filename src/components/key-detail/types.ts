import type { StorableArtifactKind } from "@/schemas/domain"

export interface IdentityQrView {
  kind: "identity-qr"
  qrKind: "bundle" | "kem" | "signing"
  targetName: string
  generatedAt: number
  artifactType: StorableArtifactKind
  artifactBytes: Uint8Array
  generation: number
}

export interface SymmetricQrView {
  kind: "symmetric-qr"
  payload: string
  acknowledged: boolean
}

export type DetailView =
  | { kind: "detail" }
  | IdentityQrView
  | SymmetricQrView
