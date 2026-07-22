// ポスト量子 ID のライフサイクル(spec2 §8/§10 — WP-13)。
// シード生成・keygen・Vault 暗号化は Worker 内(generateIdentityKeys)。
// KEM シードと DSA シードは独立の CSPRNG 呼出であること(テストで相異確認)。
import type { PqCryptoClient } from "@/crypto/pq/worker-client"
import type {
  PostQuantumIdentity,
  PqProfileId,
  PublicIdentityBundleV2,
} from "@/schemas/domain"
import { AppError, toAppError } from "@/crypto/errors"
import { PQ_PROFILES } from "@/crypto/pq/profiles"
import { pqIdentityFingerprint, pqKeyFingerprint } from "@/crypto/pq/wire-bytes"
import { generateKeyId } from "@/crypto/random"
import { keyNameSchema } from "@/schemas/key-schema"

export interface CreateIdentityArgs {
  client: PqCryptoClient
  vaultKey: CryptoKey
  name: string
  profile: PqProfileId // 初期リリースは balanced のみ UI 露出(plan2.1 §A)
  now: number
}

function assertTimestamp(value: number): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new AppError("ENCRYPTION_FAILED")
  }
}

function generateDistinctIdentityIds(): [string, string, string] {
  const ids = new Set<string>()
  // Collisions are cryptographically negligible, but the bounded retry also makes the
  // invariant explicit when the CSPRNG is replaced by a test double.
  for (let attempts = 0; ids.size < 3 && attempts < 24; attempts += 1) {
    ids.add(generateKeyId())
  }
  if (ids.size !== 3) throw new AppError("ENCRYPTION_FAILED")
  const values = [...ids]
  return [values[0]!, values[1]!, values[2]!]
}

export async function createIdentity(
  args: CreateIdentityArgs,
): Promise<PostQuantumIdentity> {
  try {
    assertTimestamp(args.now)
    const name = keyNameSchema.parse(args.name)
    const profile = PQ_PROFILES[args.profile]
    if (profile === undefined) throw new AppError("UNSUPPORTED_ALGORITHM")

    const [identityId, kemKeyId, signingKeyId] = generateDistinctIdentityIds()
    const generated = await args.client.generateIdentityKeys({
      profile: args.profile,
      vaultKey: args.vaultKey,
      identityId,
      kemKeyId,
      signingKeyId,
    })
    const bundle: PublicIdentityBundleV2 = {
      version: 2,
      type: "pq-public-identity",
      identityId,
      name,
      kem: {
        algorithm: profile.kem.algorithm,
        keyId: kemKeyId,
        publicKey: generated.kem.publicKey,
      },
      signing: {
        algorithm: profile.signature.algorithm,
        keyId: signingKeyId,
        publicKey: generated.signing.publicKey,
      },
      createdAt: args.now,
    }
    const [kemFingerprint, signingFingerprint, identityFingerprint] = await Promise.all([
      pqKeyFingerprint("kem", bundle.kem.algorithm, bundle.kem.publicKey),
      pqKeyFingerprint("signing", bundle.signing.algorithm, bundle.signing.publicKey),
      pqIdentityFingerprint(bundle),
    ])

    return {
      id: identityId,
      name,
      profile: args.profile,
      kem: {
        ...bundle.kem,
        encryptedSeed: generated.kem.encryptedSeed,
        fingerprint: kemFingerprint,
      },
      signing: {
        ...bundle.signing,
        encryptedSeed: generated.signing.encryptedSeed,
        fingerprint: signingFingerprint,
      },
      identityFingerprint,
      status: "active",
      createdAt: args.now,
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

// 旧世代は status="rotated"(復号/検証専用)で保持し、新世代を返す(plan2.1 §E1)
export interface RotateIdentityArgs {
  client: PqCryptoClient
  vaultKey: CryptoKey
  current: PostQuantumIdentity
  now: number
}

export interface RotatedIdentity {
  next: PostQuantumIdentity
  previous: PostQuantumIdentity // status を rotated へ更新した旧世代
}

export async function rotateIdentity(args: RotateIdentityArgs): Promise<RotatedIdentity> {
  try {
    assertTimestamp(args.now)
    if (args.current.status !== "active" || args.now < args.current.createdAt) {
      throw new AppError("ENCRYPTION_FAILED")
    }
    const created = await createIdentity({
      client: args.client,
      vaultKey: args.vaultKey,
      name: args.current.name,
      profile: args.current.profile,
      now: args.now,
    })
    return {
      next: { ...created, rotatedFromId: args.current.id },
      previous: {
        ...args.current,
        status: "rotated",
        rotatedAt: args.now,
      },
    }
  } catch (error) {
    throw toAppError(error, "ENCRYPTION_FAILED")
  }
}

export function buildPublicBundle(identity: PostQuantumIdentity): PublicIdentityBundleV2 {
  return {
    version: 2,
    type: "pq-public-identity",
    identityId: identity.id,
    name: identity.name,
    kem: {
      algorithm: identity.kem.algorithm,
      keyId: identity.kem.keyId,
      publicKey: identity.kem.publicKey,
    },
    signing: {
      algorithm: identity.signing.algorithm,
      keyId: identity.signing.keyId,
      publicKey: identity.signing.publicKey,
    },
    createdAt: identity.createdAt,
  }
}
