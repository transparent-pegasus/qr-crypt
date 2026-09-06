import { vi } from "vitest"
import * as fakes from "../fakes/qr-codec"

vi.mock("@/crypto/pq/canonical-cbor", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/crypto/pq/canonical-cbor")>()
  fakes.encodeSymmetricKeyEnvelopeV2.mockImplementation(
    original.encodeSymmetricKeyEnvelopeV2,
  )
  fakes.decodeSymmetricKeyEnvelopeV2.mockImplementation(
    original.decodeSymmetricKeyEnvelopeV2,
  )
  return {
    ...original,
    encodeUnsignedMessageBodyV2: fakes.encodeUnsignedMessageBodyV2,
    encodeSignedMessageV2: fakes.encodeSignedMessageV2,
    encodeMlKemEnvelopeV2: fakes.encodeMlKemEnvelopeV2,
    decodeMlKemEnvelopeV2: fakes.decodeMlKemEnvelopeV2,
    encodeSymMessageEnvelopeV2: fakes.encodeSymMessageEnvelopeV2,
    decodeSymMessageEnvelopeV2: fakes.decodeSymMessageEnvelopeV2,
    encodeSymmetricKeyEnvelopeV2: fakes.encodeSymmetricKeyEnvelopeV2,
    decodeSymmetricKeyEnvelopeV2: fakes.decodeSymmetricKeyEnvelopeV2,
    encodePublicIdentityBundleV2: fakes.encodePublicIdentityBundleV2,
    decodePublicIdentityBundleV2: fakes.decodePublicIdentityBundleV2,
  }
})
vi.mock("@/qr/decode-artifact", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/decode-artifact")>()),
  decodePayload: fakes.decodePayload,
  payloadSha256Hex: fakes.payloadSha256Hex,
}))
vi.mock("@/qr/encode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/qr/encode")>()),
  renderQrDataUrl: fakes.renderQrDataUrl,
  renderQrSvgString: fakes.renderQrSvgString,
}))
vi.mock("@/qr/multipart/split", () => ({
  splitIntoFrames: fakes.splitIntoFrames,
}))
vi.mock("@/qr/multipart/assemble", () => ({
  TransferAssembler: fakes.FakeTransferAssembler,
}))
