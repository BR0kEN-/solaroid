import type { PlantSpending, PlantSpendingType } from './types'

export const PLANT_SPENDING_TYPE_ORDER = [
  'initial',
  'damage_replacement',
  'improvement',
] as const satisfies readonly PlantSpendingType[]

export interface PlantSpendingTypeLabels {
  readonly initialInvestment: string
  readonly damageReplacement: string
  readonly improvement: string
}

export interface PlantSpendingTypeTotal {
  readonly type: PlantSpendingType
  readonly amount: number
}

export function plantSpendingTypeLabel(
  type: PlantSpendingType,
  labels: PlantSpendingTypeLabels,
) {
  const labelsByType: Record<PlantSpendingType, string> = {
    initial: labels.initialInvestment,
    damage_replacement: labels.damageReplacement,
    improvement: labels.improvement,
  }

  return labelsByType[type]
}

export function plantSpendingTypeTotals(
  spendings: readonly PlantSpending[],
  amountFor: (spending: PlantSpending) => number,
): readonly PlantSpendingTypeTotal[] {
  const totals = new Map<PlantSpendingType, number>()
  spendings.forEach((spending) => {
    totals.set(spending.type, (totals.get(spending.type) ?? 0) + amountFor(spending))
  })

  return PLANT_SPENDING_TYPE_ORDER.flatMap((type) => {
    const amount = totals.get(type)
    return amount === undefined ? [] : [{ type, amount }]
  })
}
