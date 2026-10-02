import { describe, expect, it } from "vitest"
import {
  EMPTY_CALCULATION_LINK_STATE,
  activeCalculationLink,
  calculationLinkReducer,
} from "./calculation-links"

describe("calculation links", () => {
  it("prefers hover, then focus, then a locked tap", () => {
    const locked = calculationLinkReducer(EMPTY_CALCULATION_LINK_STATE, { type: "toggle", key: "netPayment" })
    const focused = calculationLinkReducer(locked, { type: "focus", key: "costWithoutSolar" })
    const hovered = calculationLinkReducer(focused, { type: "hover", key: "importTotal" })

    expect(activeCalculationLink(locked)).toBe("netPayment")
    expect(activeCalculationLink(focused)).toBe("costWithoutSolar")
    expect(activeCalculationLink(hovered)).toBe("importTotal")
  })

  it("locks, switches, and unlocks tapped values", () => {
    const locked = calculationLinkReducer(EMPTY_CALCULATION_LINK_STATE, { type: "toggle", key: "netPayment" })
    const switched = calculationLinkReducer(locked, { type: "toggle", key: "costWithoutSolar" })
    const unlocked = calculationLinkReducer(switched, { type: "toggle", key: "costWithoutSolar" })

    expect(locked.lockedKey).toBe("netPayment")
    expect(switched.lockedKey).toBe("costWithoutSolar")
    expect(unlocked.lockedKey).toBeNull()
  })

  it("clears every interaction source", () => {
    const active = {
      hoveredKey: "importTotal" as const,
      focusedKey: "netPayment" as const,
      lockedKey: "costWithoutSolar" as const,
    }

    expect(calculationLinkReducer(active, { type: "clear" })).toEqual(EMPTY_CALCULATION_LINK_STATE)
  })
})
