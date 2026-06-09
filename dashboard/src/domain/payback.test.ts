import { describe, expect, it } from 'vitest'
import { calculatePayback, daysBetween, fullDurationBetween } from './payback'
import type { MonthRow } from './types'

function month(electricitySavings: number, date = '2026-01-01'): MonthRow {
  return {
    month: date,
    date: new Date(`${date}T00:00:00`),
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
    electricitySavings,
    usdRate: 50,
    roiUsd: electricitySavings / 50,
    isCommercial: true,
  }
}

describe('date durations', () => {
  it('calculates full months and days between dates', () => {
    expect(fullDurationBetween(new Date('2026-01-15T00:00:00'), new Date('2027-03-20T00:00:00'))).toEqual({ months: 14, days: 5 })
    expect(daysBetween(new Date('2026-01-01T10:00:00'), new Date('2026-01-03T09:00:00'))).toBe(2)
  })
})

describe('payback', () => {
  it('uses UAH as the stable cost basis across currencies', () => {
    const rows = [month(1000, '2026-01-01'), month(3000, '2026-02-01')]
    const common = {
      rows,
      investmentUsd: 200,
      launchUsdRate: 50,
      launchDate: new Date('2026-01-01T00:00:00'),
      today: new Date('2026-01-10T00:00:00'),
    }

    const uah = calculatePayback({ ...common, currency: 'UAH' })
    const usd = calculatePayback({ ...common, currency: 'USD' })

    expect(uah?.progress).toBe(40)
    expect(usd?.progress).toBe(40)
    expect(uah?.daysLeft).toBe(15)
    expect(usd?.daysLeft).toBe(15)
    expect(uah?.recovered).toBe(4000)
    expect(usd?.recovered).toBe(80)
    expect(uah?.remaining).toBe(6000)
    expect(usd?.remaining).toBe(120)
  })

  it('returns null without an investment and clamps completed payback', () => {
    expect(calculatePayback({ rows: [], investmentUsd: 0, currency: 'UAH', launchUsdRate: 40 })).toBeNull()

    const result = calculatePayback({
      rows: [month(12_000)],
      investmentUsd: 200,
      currency: 'UAH',
      launchUsdRate: 50,
      launchDate: new Date('2026-01-01T00:00:00'),
      today: new Date('2026-01-10T00:00:00'),
    })

    expect(result?.progress).toBe(100)
    expect(result?.remaining).toBe(0)
    expect(result?.daysLeft).toBe(0)
    expect(result?.payoffDuration).toEqual({ months: 0, days: 0 })
  })
})
