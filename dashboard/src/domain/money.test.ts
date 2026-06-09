import { describe, expect, it } from 'vitest'
import {
  moneyFromUah,
  moneyFromUsd,
  rowPaybackMoney,
  rowRoiMoney,
  sumRowsFromUah,
  sumRowsRoiMoney,
} from './money'
import type { MonthRow } from './types'

function month(overrides: Partial<MonthRow> = {}): MonthRow {
  return {
    month: '06.2026',
    date: new Date('2026-06-01T00:00:00'),
    production: 0,
    export: 0,
    importDay: 0,
    importNight: 0,
    consumedDay: 0,
    consumedNight: 0,
    consumedTotal: 0,
    importTotal: 0,
    balance: 0,
    exportPrice: 0,
    exportVat: 0,
    exportMilitary: 0,
    importPriceDay: 0,
    importPriceNight: 0,
    consumedPayment: 0,
    electricityPayment: 0,
    electricitySavings: 0,
    usdRate: 40,
    roiUsd: 0,
    isCommercial: true,
    ...overrides,
  }
}

describe('currency conversion', () => {
  it('converts UAH and USD with the provided rate', () => {
    expect(moneyFromUah(1000, 'UAH', 40)).toBe(1000)
    expect(moneyFromUah(1000, 'USD', 40)).toBe(25)
    expect(moneyFromUah(1000, 'USD', 0)).toBe(0)
    expect(moneyFromUsd(25, 'USD', 40)).toBe(25)
    expect(moneyFromUsd(25, 'UAH', 40)).toBe(1000)
  })
})

describe('row money helpers', () => {
  it('uses native UAH savings for UAH ROI and stored USD ROI for USD when present', () => {
    const row = month({ electricitySavings: 1200, usdRate: 40, roiUsd: 31 })

    expect(rowRoiMoney(row, 'UAH')).toBe(1200)
    expect(rowRoiMoney(row, 'USD')).toBe(31)
  })

  it('falls back to row rate for USD ROI and launch rate for payback money', () => {
    const row = month({ electricitySavings: 1200, usdRate: 40, roiUsd: 0 })

    expect(rowRoiMoney(row, 'USD')).toBe(30)
    expect(rowPaybackMoney(row, 'USD', 48)).toBe(25)
  })

  it('sums each UAH row with that row rate for display totals', () => {
    const rows = [
      month({ electricityPayment: 400, electricitySavings: 800, usdRate: 40, roiUsd: 20 }),
      month({ electricityPayment: 450, electricitySavings: 900, usdRate: 45, roiUsd: 20 }),
    ]

    expect(sumRowsFromUah(rows, (row) => row.electricityPayment, 'UAH')).toBe(850)
    expect(sumRowsFromUah(rows, (row) => row.electricityPayment, 'USD')).toBe(20)
    expect(sumRowsRoiMoney(rows, 'UAH')).toBe(1700)
    expect(sumRowsRoiMoney(rows, 'USD')).toBe(40)
  })
})
