import { within } from "@testing-library/react"
import { expect } from "vitest"

export function expectSingleAlertCancelWithoutClose(dialog: HTMLElement): void {
  expect(
    within(dialog).getAllByRole("button", { name: "Cancel" }),
  ).toHaveLength(1)
  expect(
    within(dialog).queryByRole("button", { name: "Close" }),
  ).toBeNull()
}
