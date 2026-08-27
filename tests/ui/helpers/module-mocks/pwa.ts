import { vi } from "vitest"
import * as fakes from "../fakes/pwa"

vi.mock("virtual:pwa-register/react", () => ({
  useRegisterSW: fakes.useFakeRegisterSW,
}))
vi.mock("@/hooks/use-register-sw", () => ({
  useDefaultRegisterSW: fakes.useFakeRegisterSW,
}))
