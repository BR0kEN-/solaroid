import { describe, expect, it } from 'vitest'
import { plantSpendingTypeLabel, plantSpendingTypeTotals } from './spendings'
import type { PlantSpending } from './types'

const spendings: readonly PlantSpending[] = [
  { id: 0, date: new Date('2025-06-28T00:00:00'), type: 'initial', amountUsd: 10_000 },
  { id: 1, date: new Date('2026-08-20T00:00:00'), type: 'improvement', amountUsd: 500 },
  { id: 2, date: new Date('2026-08-21T00:00:00'), type: 'damage_replacement', amountUsd: 2_000 },
  { id: 3, date: new Date('2026-08-22T00:00:00'), type: 'improvement', amountUsd: 250 },
]

describe('plant spending presentation', () => {
  it('maps every spending type to its user-facing label', () => {
    const labels = { initialInvestment: 'Initial investment', damageReplacement: 'Damage replacement', improvement: 'Improvement' }

    expect(plantSpendingTypeLabel('initial', labels)).toBe('Initial investment')
    expect(plantSpendingTypeLabel('damage_replacement', labels)).toBe('Damage replacement')
    expect(plantSpendingTypeLabel('improvement', labels)).toBe('Improvement')
  })

  it('groups present types in fixed order and omits absent types', () => {
    expect(plantSpendingTypeTotals(spendings, (spending) => spending.amountUsd)).toEqual([
      { type: 'initial', amount: 10_000 },
      { type: 'damage_replacement', amount: 2_000 },
      { type: 'improvement', amount: 750 },
    ])
    expect(plantSpendingTypeTotals(spendings.filter((spending) => spending.type === 'improvement'), (spending) => spending.amountUsd)).toEqual([
      { type: 'improvement', amount: 750 },
    ])
  })
})
