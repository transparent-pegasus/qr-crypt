import { cleanup, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { BundleConfirmView } from "@/components/key-add/bundle-confirm-view"
import { SymmetricImportView } from "@/components/key-add/symmetric-import-view"
import { LanguageProvider } from "@/i18n"
import { translate, type Language } from "@/i18n/messages"
import {
  IDENTITY_COMPARISON,
  IDENTITY_DIGEST,
  KEM_COMPARISON,
  SIGNING_COMPARISON,
} from "../fixtures/fingerprints"
import { defaultKeys } from "./helpers/fakes/key-fixtures"
import { defaultIdentity, recordFromIdentity } from "./helpers/fakes/pq-fixtures"

afterEach(cleanup)

function bundleView(identityFingerprint: string, language: Language = "en") {
  const bundle = recordFromIdentity(defaultIdentity())
  return (
    <LanguageProvider initialLanguage={language}>
      <BundleConfirmView
        bundle={{
          ...bundle,
          identityFingerprint,
          kem: { ...bundle.kem, fingerprint: "7".repeat(64) },
          signing: { ...bundle.signing, fingerprint: "8".repeat(64) },
        }}
        fingerprintChecked={false}
        busy={false}
        onFingerprintCheckedChange={vi.fn()}
        onSave={async () => undefined}
      />
    </LanguageProvider>
  )
}

describe("full fingerprint ceremony", () => {
  it("puts the complete composite identity before supplemental KEM and signing comparisons", () => {
    render(bundleView(IDENTITY_DIGEST))
    const identity = screen.getByText(IDENTITY_COMPARISON, { exact: false })
    for (const value of [KEM_COMPARISON, SIGNING_COMPARISON]) {
      const supplemental = screen.getByText(value, { exact: false })
      expect(
        identity.compareDocumentPosition(supplemental) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy()
    }
    expect(screen.queryByText(IDENTITY_DIGEST, { exact: true })).not.toBeInTheDocument()
  })

  it.each([
    {
      digest: "0000" + "0".repeat(60),
      text: "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000",
    },
    {
      digest: "2710" + "0".repeat(60),
      text: "2710 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000",
    },
    {
      digest: "0".repeat(63) + "1",
      text: "0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0000 0001",
    },
  ])("shows the independent comparison for $digest", ({ digest, text }) => {
    render(bundleView(digest))
    expect(screen.getByText(text, { exact: false })).toBeVisible()
  })

  it.each([
    {
      language: "en" as const,
      required: [
        /64/,
        /all|entire|complete/i,
        /identity/i,
        /independent|another|separate/i,
        /person|intended|contact/i,
      ],
    },
    {
      language: "ja" as const,
      required: [/64/, /すべて|全/, /本人|相手/, /独立|別/, /指紋|フィンガープリント/],
    },
  ])(
    "requires a complete independent identity acknowledgement in $language",
    ({ language, required }) => {
      render(bundleView(IDENTITY_DIGEST, language))
      const checkbox = screen.getByRole("checkbox")
      for (const requirement of required)
        expect(checkbox).toHaveAccessibleName(requirement)
      expect(checkbox).not.toBeChecked()
      expect(
        screen.getByRole("button", {
          name: translate(language, "keys.bundle.saveConfirmed"),
        }),
      ).toBeDisabled()
      expect(
        screen.getByRole("button", {
          name: translate(language, "keys.bundle.saveUnverified"),
        }),
      ).toBeEnabled()
    },
  )

  it.each(["en", "ja"] as const)(
    "requires a complete-digest acknowledgement for symmetric import in %s",
    (language) => {
      render(
        <LanguageProvider initialLanguage={language}>
          <SymmetricImportView
            record={{ ...defaultKeys()[0]!, fingerprint: IDENTITY_DIGEST }}
            name="Shared key"
            acknowledged={false}
            busy={false}
            onNameChange={vi.fn()}
            onAcknowledgedChange={vi.fn()}
            onSave={async () => undefined}
          />
        </LanguageProvider>,
      )
      expect(screen.getByText(IDENTITY_COMPARISON, { exact: false })).toBeVisible()
      const checkbox = screen.getByRole("checkbox")
      const required =
        language === "en"
          ? [
              /64/,
              /all|entire|complete/i,
              /fingerprint/i,
              /independent|another|separate/i,
            ]
          : [/64/, /すべて|全/, /指紋|フィンガープリント/, /独立|別/]
      for (const requirement of required)
        expect(checkbox).toHaveAccessibleName(requirement)
      expect(
        screen.getByRole("button", {
          name: language === "en" ? "Save the shared key" : /保存/,
        }),
      ).toBeDisabled()
    },
  )
})
