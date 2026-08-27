import { vi } from "vitest"
import * as fakes from "../fakes/symmetric-crypto"

vi.mock("@/crypto/aes-gcm", () => ({
  generateAesKey: fakes.generateAesKey,
  sealSymMessage: fakes.sealSymMessage,
  openSymMessage: fakes.openSymMessage,
}))
vi.mock("@/crypto/key-generation", () => ({
  createSymmetricKeyRecord: fakes.createSymmetricKeyRecord,
  importSymmetricKeyRecordV2: fakes.importSymmetricKeyRecordV2,
  buildSymmetricKeyEnvelopeV2: fakes.buildSymmetricKeyEnvelopeV2,
  rotateSymmetricKeyRecord: fakes.rotateSymmetricKeyRecord,
}))
