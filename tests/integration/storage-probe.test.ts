import { afterEach, describe, expect, it } from "vitest"
import { deleteDB, openDB } from "idb"

const PROBE_DB = "offline-cipher-cryptokey-probe"

interface ProbeRecord {
  id: string
  aesKey: CryptoKey
  publicKey: CryptoKey
  privateKey: CryptoKey
}

afterEach(async () => {
  await deleteDB(PROBE_DB)
})

describe("fake-indexeddb CryptoKey structured-clone probe", () => {
  it("reopens AES and non-extractable RSA keys and can decrypt with them", async () => {
    const aesKey = await crypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      true,
      ["encrypt", "decrypt"],
    )
    const rsaPair = await crypto.subtle.generateKey(
      {
        name: "RSA-OAEP",
        modulusLength: 3072,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256",
      },
      false,
      ["encrypt", "decrypt", "wrapKey", "unwrapKey"],
    )
    expect(rsaPair.privateKey.extractable).toBe(false)

    const db = await openDB(PROBE_DB, 1, {
      upgrade(database) {
        database.createObjectStore("records", { keyPath: "id" })
      },
    })
    await db.put("records", {
      id: "probe",
      aesKey,
      publicKey: rsaPair.publicKey,
      privateKey: rsaPair.privateKey,
    } satisfies ProbeRecord)
    db.close()

    const reopened = await openDB(PROBE_DB, 1)
    const restored = (await reopened.get("records", "probe")) as ProbeRecord | undefined
    expect(restored).toBeDefined()
    expect(restored?.privateKey.extractable).toBe(false)

    const iv = new Uint8Array(12)
    crypto.getRandomValues(iv)
    const plaintext = new TextEncoder().encode("probe-value")
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      restored!.aesKey,
      plaintext,
    )
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      restored!.aesKey,
      ciphertext,
    )
    expect(new Uint8Array(decrypted)).toEqual(plaintext)

    const wrapped = await crypto.subtle.wrapKey(
      "raw",
      restored!.aesKey,
      restored!.publicKey,
      { name: "RSA-OAEP" },
    )
    const unwrapped = await crypto.subtle.unwrapKey(
      "raw",
      wrapped,
      restored!.privateKey,
      { name: "RSA-OAEP" },
      { name: "AES-GCM", length: 256 },
      false,
      ["decrypt"],
    )
    const decryptedWithUnwrapped = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 },
      unwrapped,
      ciphertext,
    )
    expect(new Uint8Array(decryptedWithUnwrapped)).toEqual(plaintext)
    reopened.close()
  })
})
