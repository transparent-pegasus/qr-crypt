import { vi } from "vitest"
import * as fakes from "../fakes/pwa"

vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: fakes.useFakeRegisterSW,
}))
