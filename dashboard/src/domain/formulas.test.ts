import { describe, expect, it } from 'vitest'
import {
  balance,
  commercialBalance,
  consumedPrice,
  consumedTotal,
  exportTaxRate,
  importTotal,
  netExportPrice,
  payment,
  savings,
  selfConsumed,
  selfConsumptionSavings,
  weightedImportPrice,
} from './formulas'
import type { EnergySnapshot, Tariff } from './types'

const tariff: Tariff = {
  importDay: 4.32,
  importNight: 2.16,
  export: 6,
  exportTaxes: [
    ['vat', 20],
    ['mil', 5],
  ],
}

const row: EnergySnapshot = {
  production: 100,
  export: 30,
  importDay: 20,
  importNight: 10,
  consumedDay: 80,
  consumedNight: 20,
}

describe('energy totals', () => {
  it('calculates consumption, import, and grid balance', () => {
    expect(consumedTotal(row)).toBe(100)
    expect(importTotal(row)).toBe(30)
    expect(balance(row)).toBe(0)
    expect(commercialBalance(row, true)).toBe(0)
    expect(commercialBalance(row, false)).toBe(30)
  })
})

describe('prices and taxes', () => {
  it('calculates export taxes and net export price', () => {
    expect(exportTaxRate(tariff)).toBe(0.25)
    expect(netExportPrice(tariff)).toBe(4.5)
  })

  it('calculates consumed and weighted import prices', () => {
    expect(consumedPrice(row, tariff)).toBe(388.8)
    expect(weightedImportPrice(row, tariff)).toBe(3.6)
    expect(weightedImportPrice({ ...row, importDay: 0, importNight: 0 }, tariff)).toBe(tariff.importDay)
    expect(weightedImportPrice({ ...row, importDay: 0, importNight: 0 }, { ...tariff, importDay: 0 })).toBe(tariff.importNight)
  })
})

describe('self consumption', () => {
  it('uses measured day/night self consumption when available', () => {
    expect(selfConsumed(row)).toBe(70)
    expect(selfConsumptionSavings(row, tariff)).toBeCloseTo(280.8)
  })

  it('falls back to production minus export at weighted import price', () => {
    const inferred: EnergySnapshot = {
      production: 50,
      export: 15,
      importDay: 20,
      importNight: 10,
      consumedDay: 10,
      consumedNight: 5,
    }

    expect(selfConsumptionSavings(inferred, tariff)).toBe(126)
  })
})

describe('payment and savings', () => {
  it('charges remaining import after commercial export offset', () => {
    expect(payment(row, tariff, true)).toBeCloseTo(0)
    expect(payment({ ...row, export: 15 }, tariff, true)).toBe(-54)
  })

  it('pays export surplus after taxes in commercial periods', () => {
    expect(payment({ ...row, export: 50 }, tariff, true)).toBe(90)
  })

  it('ignores export offset before commercial date', () => {
    expect(payment(row, tariff, false)).toBe(-108)
    expect(savings(row, tariff, false)).toBeCloseTo(280.8)
  })

  it('calculates commercial savings as consumed price plus net payment', () => {
    expect(savings({ ...row, export: 15 }, tariff, true)).toBe(334.8)
  })
})
