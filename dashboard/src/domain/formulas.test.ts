import { describe, expect, it } from 'vitest'
import {
  balance,
  capacityAdjustedProductionSurplus,
  capacityDeltaPct,
  commercialBalance,
  consumedPrice,
  consumedTotal,
  exportPayout,
  exportTaxRate,
  importCostBreakdown,
  importTotal,
  netExportPrice,
  netExportNightPrice,
  payment,
  plantCapacityKwp,
  productionYieldKwhPerKwp,
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
  exportNight: 0,
  exportTaxes: [
    ['vat', 20],
    ['mil', 5],
  ],
}

const row: EnergySnapshot = {
  production: 100,
  exportDay: 30,
  exportNight: 0,
  importDay: 20,
  importNight: 10,
  consumedDay: 80,
  consumedNight: 20,
}

const electricHeatingTariff: Tariff = {
  ...tariff,
  importDay: 2.64,
  importNight: 1.32,
  electricHeatingThresholdKwh: 2000,
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

describe('plant production capacity', () => {
  it('sums PV field power as kWp', () => {
    expect(plantCapacityKwp({
      pvs: [
        { azimuth: 0, power: 11160, slope: 30, elevation: 120, lat: 0, lng: 0, loss: 14, mounting: 'building' },
        { azimuth: 90, power: 8680, slope: 30, elevation: 120, lat: 0, lng: 0, loss: 14, mounting: 'building' },
      ],
    })).toBeCloseTo(19.84)
  })

  it('calculates capacity percent from first plant vs second plant', () => {
    expect(capacityDeltaPct(19.84, 14.88)).toBeCloseTo(33.3333)
  })

  it('normalizes production by capacity', () => {
    expect(productionYieldKwhPerKwp(12_400, 19.84)).toBeCloseTo(625)
  })

  it('calculates capacity-adjusted production surplus', () => {
    expect(capacityAdjustedProductionSurplus(12_400, 9_000, 19.84, 14.88)).toBeCloseTo(400)
  })

  it('returns undefined for missing or zero capacity inputs', () => {
    expect(plantCapacityKwp(null)).toBeUndefined()
    expect(plantCapacityKwp({ pvs: [] })).toBeUndefined()
    expect(productionYieldKwhPerKwp(100, 0)).toBeUndefined()
    expect(capacityDeltaPct(10, 0)).toBeUndefined()
    expect(capacityAdjustedProductionSurplus(100, 80, 10, 0)).toBeUndefined()
  })
})

describe('prices and taxes', () => {
  it('calculates export taxes and net export price', () => {
    expect(exportTaxRate(tariff)).toBe(0.25)
    expect(netExportPrice(tariff)).toBe(4.5)
    expect(netExportNightPrice({ ...tariff, exportNight: 4 })).toBe(3)
  })

  it('calculates consumed and weighted import prices', () => {
    expect(consumedPrice(row, tariff)).toBe(388.8)
    expect(weightedImportPrice(row, tariff)).toBe(3.6)
    expect(weightedImportPrice({ ...row, importDay: 0, importNight: 0 }, tariff)).toBe(tariff.importDay)
    expect(weightedImportPrice({ ...row, importDay: 0, importNight: 0 }, { ...tariff, importDay: 0 })).toBe(tariff.importNight)
  })

  it('charges all net import at electric heating rates below threshold', () => {
    const breakdown = importCostBreakdown(1144.83, 847.17, electricHeatingTariff)

    expect(breakdown.discountedDay).toBeCloseTo(1144.83)
    expect(breakdown.discountedNight).toBeCloseTo(847.17)
    expect(breakdown.regularDay).toBe(0)
    expect(breakdown.regularNight).toBe(0)
    expect(breakdown.total).toBeCloseTo(1144.83 * 2.64 + 847.17 * 1.32)
  })

  it('splits electric heating excess proportionally by balanced day/night import', () => {
    const breakdown = importCostBreakdown(1164.35, 895.65, electricHeatingTariff)

    expect(breakdown.regularDay).toBeCloseTo(33.91, 1)
    expect(breakdown.regularNight).toBeCloseTo(26.09, 1)
    expect(breakdown.discountedDay).toBeCloseTo(1130.44, 1)
    expect(breakdown.discountedNight).toBeCloseTo(869.56, 1)
    expect(breakdown.total).toBeCloseTo(
      1130.44 * 2.64 +
      869.56 * 1.32 +
      33.91 * 4.32 +
      26.09 * 2.16,
      0,
    )
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
      exportDay: 15,
      exportNight: 0,
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
    expect(payment({ ...row, exportDay: 15, exportNight: 0 }, tariff, true)).toBe(-54)
  })

  it('applies electric heating threshold after proportional export offset', () => {
    const nearThreshold: EnergySnapshot = {
      production: 0,
      exportDay: 9,
      exportNight: 0,
      importDay: 1150,
      importNight: 851,
      consumedDay: 1150,
      consumedNight: 851,
    }
    const aboveThreshold: EnergySnapshot = {
      production: 0,
      exportDay: 10,
      exportNight: 0,
      importDay: 1170,
      importNight: 900,
      consumedDay: 1170,
      consumedNight: 900,
    }

    expect(payment(nearThreshold, electricHeatingTariff, true)).toBeCloseTo(
      -(1144.83 * 2.64 + 847.17 * 1.32),
      0,
    )
    expect(payment(aboveThreshold, electricHeatingTariff, true)).toBeCloseTo(
      -(
        1130.44 * 2.64 +
        869.56 * 1.32 +
        33.91 * 4.32 +
        26.09 * 2.16
      ),
      0,
    )
  })

  it('falls back to regular import rates without electric heating eligibility', () => {
    expect(payment({ ...row, exportDay: 15, exportNight: 0 }, tariff, true)).toBe(-54)
  })

  it('pays export surplus after taxes in commercial periods', () => {
    expect(payment({ ...row, exportDay: 50, exportNight: 0 }, tariff, true)).toBe(90)
  })

  it('pays export surplus with day/night export prices by export split', () => {
    const splitTariff = { ...tariff, exportNight: 4 }
    const splitRow = { ...row, exportDay: 40, exportNight: 20, importDay: 10, importNight: 10 }

    expect(exportPayout(splitRow, splitTariff)).toBeCloseTo(160)
    expect(payment(splitRow, splitTariff, true)).toBeCloseTo(160)
  })

  it('ignores export offset before commercial date', () => {
    expect(payment(row, tariff, false)).toBe(-108)
    expect(savings(row, tariff, false)).toBeCloseTo(280.8)
  })

  it('calculates commercial savings as consumed price plus net payment', () => {
    expect(savings({ ...row, exportDay: 15, exportNight: 0 }, tariff, true)).toBe(334.8)
  })
})
