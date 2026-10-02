export type CalculationLinkKey =
  | "consumedTotal"
  | "consumedDay"
  | "consumedNight"
  | "importTotal"
  | "importDay"
  | "importNight"
  | "exportTotal"
  | "exportDay"
  | "exportNight"
  | "importPriceDay"
  | "importPriceNight"
  | "regularImportPriceDay"
  | "regularImportPriceNight"
  | "netExportPriceDay"
  | "netExportPriceNight"
  | "electricHeatingThreshold"
  | "consumedTierDay"
  | "consumedTierNight"
  | "consumedRegularDay"
  | "consumedRegularNight"
  | "consumedTierDayCost"
  | "consumedTierNightCost"
  | "consumedRegularDayCost"
  | "consumedRegularNightCost"
  | "coveredImportDay"
  | "coveredImportNight"
  | "remainingImportDay"
  | "remainingImportNight"
  | "remainingImportTotal"
  | "paymentTierDayCost"
  | "paymentTierNightCost"
  | "paymentRegularDayCost"
  | "paymentRegularNightCost"
  | "netSurplus"
  | "beforePayment"
  | "afterPayment"
  | "netPayment"
  | "costWithoutSolar"
  | "roi"

export interface CalculationLinkState {
  readonly hoveredKey: CalculationLinkKey | null
  readonly focusedKey: CalculationLinkKey | null
  readonly lockedKey: CalculationLinkKey | null
}

interface HoverCalculationLinkAction {
  readonly type: "hover"
  readonly key: CalculationLinkKey | null
}

interface FocusCalculationLinkAction {
  readonly type: "focus"
  readonly key: CalculationLinkKey | null
}

interface ToggleCalculationLinkAction {
  readonly type: "toggle"
  readonly key: CalculationLinkKey
}

interface ClearCalculationLinkAction {
  readonly type: "clear"
}

export type CalculationLinkAction =
  | HoverCalculationLinkAction
  | FocusCalculationLinkAction
  | ToggleCalculationLinkAction
  | ClearCalculationLinkAction

export const EMPTY_CALCULATION_LINK_STATE: CalculationLinkState = {
  hoveredKey: null,
  focusedKey: null,
  lockedKey: null,
}

export function activeCalculationLink(state: CalculationLinkState) {
  return state.hoveredKey ?? state.focusedKey ?? state.lockedKey
}

export function calculationLinkReducer(
  state: CalculationLinkState,
  action: CalculationLinkAction,
): CalculationLinkState {
  switch (action.type) {
    case "hover":
      return { ...state, hoveredKey: action.key }
    case "focus":
      return { ...state, focusedKey: action.key }
    case "toggle":
      return { ...state, lockedKey: state.lockedKey === action.key ? null : action.key }
    case "clear":
      return EMPTY_CALCULATION_LINK_STATE
  }
}
