import { describe, expect, it } from 'vitest'
import { calculateCommercialEndRecovery, calculatePayback, daysBetween, fullDurationBetween } from './payback'
import type { MonthRow } from './types'

function month(electricitySavings: number, date = '2026-01-01', usdRate = 50): MonthRow {
  return {
    month: date,
    date: new Date(`${date}T00:00:00`),
    production: 0,
    exportDay: 0,
    exportNight: 0,
    importDay: 0,
    importNight: 0,
    consumedDay: 0,
    consumedNight: 0,
    consumedTotal: 0,
    importTotal: 0,
    balance: 0,
    exportPrice: 5,
    exportPriceDay: 5,
    exportPriceNight: 0,
    exportVat: 0,
    exportMilitary: 0,
    importPriceDay: 4,
    importPriceNight: 2,
    consumedPayment: 0,
    electricityPayment: 0,
    electricitySavings,
    usdRate,
    roiUsd: electricitySavings / usdRate,
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
  it('uses each mode currency basis for recovered value and payback', () => {
    const rows = [month(1000, '2026-01-01', 40), month(3000, '2026-02-01', 60)]
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
    expect(usd?.progress).toBe(37.5)
    expect(uah?.daysLeft).toBe(15)
    expect(usd?.daysLeft).toBe(17)
    expect(uah?.recovered).toBe(4000)
    expect(usd?.recovered).toBe(75)
    expect(uah?.remaining).toBe(6000)
    expect(usd?.remaining).toBe(125)
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

  it('projects commercial end recovery from a completed commercial year template', () => {
    const rows = [
      month(100, '2025-06-01'),
      month(1_000, '2025-09-01'),
      month(1_000, '2025-10-01'),
      month(1_000, '2025-11-01'),
      month(1_000, '2025-12-01'),
      month(1_000, '2026-01-01'),
      month(1_000, '2026-02-01'),
      month(1_000, '2026-03-01'),
      month(1_000, '2026-04-01'),
      month(1_000, '2026-05-01'),
      month(1_000, '2026-06-01'),
    ]
    const payback = calculatePayback({
      rows,
      investmentUsd: 10_000,
      currency: 'UAH',
      launchUsdRate: 100,
      launchDate: new Date('2025-06-28T00:00:00'),
      today: new Date('2026-06-20T00:00:00'),
    })

    expect(payback).not.toBeNull()

    const result = calculateCommercialEndRecovery({
      rows,
      payback: payback!,
      currency: 'UAH',
      commercialDate: new Date('2025-09-01T00:00:00'),
      launchDate: new Date('2025-06-28T00:00:00'),
      endDate: new Date('2030-01-01T00:00:00'),
      projection: {
        monthlyKwh: [3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000],
        dailyKwh: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      },
    })

    expect(result.recovered).toBeCloseTo(667_138.89)
    expect(result.progress).toBeCloseTo(66.71)
    expect(result.details?.annualProduction).toEqual({
      kwh: 36_000,
      source: 'pvgis',
      closedYearCount: 0,
    })
  })

  it('projects young plants from PVGIS when no closed years exist', () => {
    const rows = [
      month(1_900, '2026-06-01'),
    ]
    const payback = calculatePayback({
      rows,
      investmentUsd: 10_000,
      currency: 'UAH',
      launchUsdRate: 100,
      launchDate: new Date('2026-06-01T00:00:00'),
      today: new Date('2026-06-20T00:00:00'),
    })

    expect(payback).not.toBeNull()

    const result = calculateCommercialEndRecovery({
      rows,
      payback: payback!,
      currency: 'UAH',
      commercialDate: new Date('2026-06-01T00:00:00'),
      launchDate: new Date('2026-06-01T00:00:00'),
      endDate: new Date('2030-01-01T00:00:00'),
      projection: {
        monthlyKwh: [3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000],
        dailyKwh: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      },
    })

    expect(result.recovered).toBeCloseTo(543_472.22)
    expect(result.progress).toBeCloseTo(54.35)
  })

  it('calculates annual commercial recovery as PVGIS surplus plus self-consumption savings', () => {
    const rows = [{ ...month(0, '2026-01-01'), exportPrice: 5.15, exportPriceDay: 5.15 }]
    const payback = calculatePayback({
      rows,
      investmentUsd: 10_000,
      currency: 'UAH',
      launchUsdRate: 100,
      launchDate: new Date('2026-01-01T00:00:00'),
      today: new Date('2026-01-01T00:00:00'),
    })

    expect(payback).not.toBeNull()

    const result = calculateCommercialEndRecovery({
      rows,
      payback: payback!,
      currency: 'UAH',
      commercialDate: new Date('2026-01-01T00:00:00'),
      launchDate: new Date('2026-01-01T00:00:00'),
      endDate: new Date('2027-01-01T00:00:00'),
      projection: {
        monthlyKwh: Array.from({ length: 12 }, () => 25_000 / 12),
        dailyKwh: Array.from({ length: 12 }, () => 1),
      },
    })

    expect(result.recovered).toBeCloseTo(97_866.67)
    expect(result.details?.annualProduction.kwh).toBeCloseTo(25_000)
    expect(result.details?.annualSurplus.kwh).toBeCloseTo(8_000)
  })

  it('uses a closed year as annual production when available', () => {
    const rows = Array.from({ length: 12 }, (_, index) => ({
      ...month(0, `2026-${String(index + 1).padStart(2, '0')}-01`),
      production: 1_000,
      consumedDay: 600,
      consumedNight: 400,
    }))
    const payback = calculatePayback({
      rows,
      investmentUsd: 10_000,
      currency: 'UAH',
      launchUsdRate: 100,
      launchDate: new Date('2026-01-01T00:00:00'),
      today: new Date('2027-01-01T00:00:00'),
    })

    expect(payback).not.toBeNull()

    const result = calculateCommercialEndRecovery({
      rows,
      payback: payback!,
      currency: 'UAH',
      commercialDate: new Date('2026-01-01T00:00:00'),
      launchDate: new Date('2026-01-01T00:00:00'),
      endDate: new Date('2030-01-01T00:00:00'),
      projection: null,
      today: new Date('2027-01-01T00:00:00'),
    })

    expect(result.details?.annualProduction).toEqual({
      kwh: 12_000,
      source: 'closed-year',
      closedYearCount: 1,
    })
    expect(result.details?.annualConsumption.dayKwh).toBe(7_200)
    expect(result.details?.annualConsumption.nightKwh).toBe(4_800)
    expect(result.details?.annualSurplus.kwh).toBe(0)
  })

  it('uses self-consumption and zero export payout after the commercial period', () => {
    const rows = [month(0, '2029-12-01')]
    const payback = calculatePayback({
      rows,
      investmentUsd: 155,
      currency: 'UAH',
      launchUsdRate: 100,
      launchDate: new Date('2029-12-01T00:00:00'),
      today: new Date('2029-12-01T00:00:00'),
    })

    expect(payback).not.toBeNull()

    const result = calculateCommercialEndRecovery({
      rows,
      payback: payback!,
      currency: 'UAH',
      commercialDate: new Date('2029-12-01T00:00:00'),
      launchDate: new Date('2029-12-01T00:00:00'),
      endDate: new Date('2030-01-01T00:00:00'),
      projection: {
        monthlyKwh: [3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000, 3_000],
        dailyKwh: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      },
    })

    expect(result.recovered).toBeCloseTo(12_638.89)
    expect(result.roiPhase).toBe('post-commercial')
    expect(result.roiDate?.toISOString().slice(0, 10)).toBe('2030-01-19')
  })
})
