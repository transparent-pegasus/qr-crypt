import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppProviders } from "@/app/providers"
import { LanguageProvider } from "@/i18n"
import { KeyListPage } from "@/pages/key-list-page"
import {
  deleteEntireDatabase,
  getDb,
  STORE_KEYS,
} from "@/storage/database"
import { listKeyRecords } from "@/storage/key-repository"
import {
  LEGACY_RSA_ID,
  legacyRsaRecord,
} from "../fixtures/legacy-rsa-record"

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: () => ({ offlineReady: [false, () => undefined] }),
}))
vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: () => ({ offlineReady: [false, () => undefined] }),
}))

describe("key list legacy-storage isolation", () => {
  beforeEach(async () => {
    await deleteEntireDatabase()
  })

  afterEach(async () => {
    cleanup()
    await deleteEntireDatabase()
  })

  it("renders while silently omitting an existing RSA row without repairing it", async () => {
    const database = await getDb()
    await database.add(STORE_KEYS, (await legacyRsaRecord()) as never)

    render(
      <LanguageProvider initialLanguage="en">
        <AppProviders
          features={{
            webCrypto: true,
            indexedDb: true,
            camera: false,
            serviceWorker: false,
          }}
          pwaHook={undefined}
        >
          <KeyListPage />
        </AppProviders>
      </LanguageProvider>,
    )

    expect(await screen.findByText("You have no keys.")).toBeInTheDocument()
    expect(screen.queryByText("retired RSA row")).not.toBeInTheDocument()

    const persisted = await database.get(STORE_KEYS, LEGACY_RSA_ID)
    expect({
      listedNames: (await listKeyRecords()).map(({ name }) => name),
      storedRows: await database.count(STORE_KEYS),
      persistedKind: (persisted as { kind?: unknown } | undefined)?.kind,
      persistedAlgorithm: (persisted as { algorithm?: unknown } | undefined)
        ?.algorithm,
    }).toEqual({
      listedNames: [],
      storedRows: 1,
      persistedKind: "rsa-key-pair",
      persistedAlgorithm: "RSA-OAEP-3072",
    })
  })
})
