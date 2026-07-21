// 鍵の生成・取込を StoredKeyRecord へ束ねる高レベル API(永続化はしない —
// 保存は storage/key-repository の責務)。
import type {
  PublicKeyEnvelopeV1,
  SymmetricKeyEnvelopeV1,
} from "@/crypto/envelope"
import type { StoredKeyRecord } from "@/schemas/domain"

function notImplemented(...args: unknown[]): never {
  void args
  throw new Error("not implemented")
}

export function createSymmetricKeyRecord(
  name: string,
  now: number,
): Promise<StoredKeyRecord> {
  return notImplemented(name, now)
}

export function createRsaKeyPairRecord(
  name: string,
  now: number,
): Promise<StoredKeyRecord> {
  return notImplemented(name, now)
}

export function importSymmetricKeyRecord(
  name: string,
  envelope: SymmetricKeyEnvelopeV1,
  now: number,
): Promise<StoredKeyRecord> {
  return notImplemented(name, envelope, now)
}

export function importPublicKeyRecord(
  name: string,
  envelope: PublicKeyEnvelopeV1,
  now: number,
): Promise<StoredKeyRecord> {
  return notImplemented(name, envelope, now)
}

export function buildSymmetricKeyEnvelope(
  record: StoredKeyRecord,
): Promise<SymmetricKeyEnvelopeV1> {
  return notImplemented(record)
}

export function buildPublicKeyEnvelope(
  record: StoredKeyRecord,
): Promise<PublicKeyEnvelopeV1> {
  return notImplemented(record)
}
