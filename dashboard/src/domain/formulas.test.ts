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
  greenTariffReceiptReconciliation,
  grossExportPayout,
  importCostBreakdown,
  importTotal,
  netExportPrice,
  netExportNightPrice,
  payment,
  plantCapacityKwp,
  productionYieldKwhPerKwp,
  reconciliationValue,
  repriceMonthRow,
  savings,
  selfConsumed,
  selfConsumptionSavings,
  weightedImportPrice,
} from './formulas'
import type { EnergySnapshot, GreenTariffReport, MonthRow, MonthTariffScenario, Tariff } from './types'

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

describe('green tariff receipt reconciliation', () => {
  const receiptRow: MonthRow = {
    month: 'May 2026',
    date: new Date('2026-05-01T00:00:00'),
    production: 300,
    exportDay: 180,
    exportNight: 20,
    importDay: 40,
    importNight: 10,
    consumedDay: 100,
    consumedNight: 50,
    consumedTotal: 150,
    importTotal: 50,
    balance: -150,
    exportPrice: 6,
    exportPriceDay: 6,
    exportPriceNight: 4,
    exportPersonalIncomeTax: 18,
    exportMilitary: 5,
    importPriceDay: 4.32,
    importPriceNight: 2.16,
    consumedPayment: 0,
    electricityPayment: 669.9,
    electricitySavings: 0,
    usdRate: 40,
    roiUsd: 0,
    isCommercial: true,
  }
  const report: GreenTariffReport = {
    account: 'synthetic-account',
    eic: '00X0000000000000',
    actDate: '2026-05-31',
    energy: {
      grid: { importKwh: 50, exportKwh: 200 },
      payable: { consumerKwh: 0, supplierKwh: 150 },
    },
    purchase: {
      greenTariff: { kwh: 135, priceKopPerKwh: 600, amountUah: 810 },
      weightedPrice: { kwh: 15, priceKopPerKwh: 400, amountUah: 60 },
    },
    payment: {
      grossUah: 870,
      taxes: { personalIncomeUah: 156.6, militaryLevyUah: 43.5 },
      netUah: 669.9,
    },
  }

  it('reconciles matching grid, payable, split-price payout, and taxes', () => {
    const result = greenTariffReceiptReconciliation(receiptRow, report)

    expect(result.grid.importKwh.delta).toBe(0)
    expect(result.grid.exportKwh.delta).toBe(0)
    expect(result.payable.consumerKwh.delta).toBe(0)
    expect(result.payable.supplierKwh.delta).toBe(0)
    expect(result.settlement.grossUah.solaroid).toBeCloseTo(870)
    expect(result.settlement.netUah.solaroid).toBeCloseTo(669.9)
    expect(result.taxes.personalIncomeUah.solaroid).toBeCloseTo(156.6)
    expect(result.taxes.militaryLevyUah.solaroid).toBeCloseTo(43.5)
    expect(result.summary.withheldUah).toBeCloseTo(200.1)
    expect(result.summary.effectiveGrossUahPerKwh).toBeCloseTo(5.8)
    expect(result.summary.effectiveNetUahPerKwh).toBeCloseTo(4.466)
    expect(result.summary.withheldTaxPercent).toBeCloseTo(23)
    expect(result.energySource).toBe('home-assistant')
  })

  it('calculates receipt-minus-Solaroid deltas and unsigned percentages', () => {
    const result = greenTariffReceiptReconciliation(receiptRow, {
      ...report,
      energy: {
        grid: { importKwh: 51, exportKwh: 198 },
        payable: { consumerKwh: 2, supplierKwh: 155 },
      },
    })

    expect(result.grid.importKwh.delta).toBe(1)
    expect(result.grid.importKwh.deltaPercent).toBe(2)
    expect(result.grid.exportKwh.delta).toBe(-2)
    expect(result.grid.exportKwh.deltaPercent).toBe(1)
    expect(result.payable.supplierKwh.delta).toBe(5)
    expect(result.payable.supplierKwh.deltaPercent).toBeCloseTo(3.3333)
  })

  it('checks purchase rows, totals, and net arithmetic without tolerance states', () => {
    const result = greenTariffReceiptReconciliation(receiptRow, {
      ...report,
      purchase: {
        greenTariff: { kwh: 135, priceKopPerKwh: 600, amountUah: 811 },
        weightedPrice: { kwh: 15, priceKopPerKwh: 400, amountUah: 60 },
      },
      payment: {
        ...report.payment,
        grossUah: 872,
        netUah: 670,
      },
    })

    expect(result.arithmetic.supplierPayableKwh.delta).toBe(0)
    expect(result.arithmetic.greenTariffAmountUah.delta).toBe(1)
    expect(result.arithmetic.weightedPriceAmountUah.delta).toBe(0)
    expect(result.arithmetic.grossUah.delta).toBe(1)
    expect(result.arithmetic.netUah.delta).toBeCloseTo(-1.9)
  })

  it('preserves small purchase rounding differences', () => {
    const result = greenTariffReceiptReconciliation(receiptRow, {
      ...report,
      purchase: {
        ...report.purchase,
        weightedPrice: { kwh: 3, priceKopPerKwh: 333.33, amountUah: 10 },
      },
    })

    expect(result.arithmetic.weightedPriceAmountUah.solaroid).toBeCloseTo(9.9999)
    expect(result.arithmetic.weightedPriceAmountUah.delta).toBeCloseTo(0.0001)
  })

  it('handles zero comparison baselines', () => {
    expect(reconciliationValue(0, 0).deltaPercent).toBe(0)
    expect(reconciliationValue(5, 0).deltaPercent).toBeUndefined()
  })

  it('calculates gross split-price payout before taxes', () => {
    expect(grossExportPayout(receiptRow, {
      importDay: 4.32,
      importNight: 2.16,
      export: 6,
      exportNight: 4,
      exportTaxes: [],
    })).toBeCloseTo(870)
  })

  it('identifies utility-meter energy as the Solaroid source', () => {
    const result = greenTariffReceiptReconciliation({
      ...receiptRow,
      utilityMeter: {
        ha: { importDay: 39, importNight: 10, exportDay: 179, exportNight: 20 },
        utility: { importDay: 40, importNight: 10, exportDay: 180, exportNight: 20 },
      },
    }, report)

    expect(result.energySource).toBe('utility-meter')
  })
})

describe('monthly tariff what-if', () => {
  const baseRow: MonthRow = {
    month: 'May 2026',
    date: new Date('2026-05-01T00:00:00'),
    production: 300,
    exportDay: 180,
    exportNight: 20,
    importDay: 40,
    importNight: 10,
    consumedDay: 100,
    consumedNight: 50,
    consumedTotal: 150,
    importTotal: 50,
    balance: -150,
    exportPrice: 6,
    exportPriceDay: 6,
    exportPriceNight: 4,
    exportPersonalIncomeTax: 18,
    exportMilitary: 5,
    importPriceDay: 4.32,
    importPriceNight: 2.16,
    consumedPayment: 540,
    electricityPayment: 669.9,
    electricitySavings: 1_209.9,
    usdRate: 40,
    roiUsd: 30.2475,
    isCommercial: true,
  }
  const scenario: MonthTariffScenario = {
    netExportDayUahPerKwh: 9.24,
    importDayUahPerKwh: 8.64,
    importNightUahPerKwh: 4.32,
    usdRate: 40,
  }

  it('scales both gross export zones proportionally and recalculates commercial values', () => {
    const result = repriceMonthRow(baseRow, scenario)

    expect(result.exportPriceDay).toBeCloseTo(12)
    expect(result.exportPriceNight).toBeCloseTo(8)
    expect(result.importPriceDay).toBeCloseTo(8.64)
    expect(result.importPriceNight).toBeCloseTo(4.32)
    expect(result.consumedPayment).toBeCloseTo(1_080)
    expect(result.electricityPayment).toBeCloseTo(1_339.8)
    expect(result.electricitySavings).toBeCloseTo(2_419.8)
    expect(result.roiUsd).toBeCloseTo(60.495)
  })

  it('recalculates non-commercial import payment without paying export', () => {
    const result = repriceMonthRow({
      ...baseRow,
      exportDay: 30,
      exportNight: 0,
      importDay: 20,
      importNight: 10,
      balance: 0,
      isCommercial: false,
    }, scenario)

    expect(result.electricityPayment).toBeCloseTo(-216)
    expect(result.electricitySavings).toBeCloseTo(864)
  })

  it('preserves the electric-heating threshold calculation', () => {
    const heatingRow: MonthRow = {
      ...baseRow,
      production: 0,
      exportDay: 0,
      exportNight: 0,
      importDay: 1_164.35,
      importNight: 895.65,
      consumedDay: 1_164.35,
      consumedNight: 895.65,
      importTotal: 2_060,
      consumedTotal: 2_060,
      balance: 2_060,
      electricHeatingThresholdKwh: 2_000,
    }
    const result = repriceMonthRow(heatingRow, {
      ...scenario,
      importDayUahPerKwh: 2.64,
      importNightUahPerKwh: 1.32,
    })

    expect(result.electricityPayment).toBeCloseTo(-importCostBreakdown(1_164.35, 895.65, electricHeatingTariff).total)
  })

  it('aggregates repriced daily values for a commercial transition month', () => {
    const before = { ...baseRow, month: '2026-05-10', date: new Date('2026-05-10T00:00:00'), isCommercial: false }
    const after = { ...baseRow, month: '2026-05-20', date: new Date('2026-05-20T00:00:00'), isCommercial: true }
    const expectedBefore = repriceMonthRow(before, scenario)
    const expectedAfter = repriceMonthRow(after, scenario)
    const result = repriceMonthRow(baseRow, scenario, [before, after])

    expect(result.electricityPayment).toBeCloseTo(expectedBefore.electricityPayment + expectedAfter.electricityPayment)
    expect(result.electricitySavings).toBeCloseTo(expectedBefore.electricitySavings + expectedAfter.electricitySavings)
  })

  it('does not invent a proportional export price from a zero baseline', () => {
    const result = repriceMonthRow({ ...baseRow, exportPrice: 0, exportPriceDay: 0, exportPriceNight: 0 }, scenario)

    expect(result.exportPriceDay).toBe(0)
    expect(result.exportPriceNight).toBe(0)
  })

  it('changes USD ROI without changing canonical UAH financial values', () => {
    const result = repriceMonthRow(baseRow, {
      netExportDayUahPerKwh: 4.62,
      importDayUahPerKwh: 4.32,
      importNightUahPerKwh: 2.16,
      usdRate: 50,
    })

    expect(result.electricityPayment).toBeCloseTo(669.9)
    expect(result.electricitySavings).toBeCloseTo(1_209.9)
    expect(result.usdRate).toBe(50)
    expect(result.roiUsd).toBeCloseTo(24.198)
  })
})
