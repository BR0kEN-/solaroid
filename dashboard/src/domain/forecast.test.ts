import { describe, expect, it } from 'vitest'
import { calculateForecast } from './forecast'
import type { MonthRow } from './types'

function month({
  date,
  production,
  electricitySavings,
  electricityPayment,
  usdRate,
}: {
  readonly date: string
  readonly production: number
  readonly electricitySavings: number
  readonly electricityPayment: number
  readonly usdRate: number
}): MonthRow {
  return {
    month: date,
    date: new Date(`${date}T00:00:00`),
    production,
    exportDay: 0,
    exportNight: 0,
    importDay: 0,
    importNight: 0,
    consumedDay: 0,
    consumedNight: 0,
    consumedTotal: 0,
    importTotal: 0,
    balance: 0,
    exportPrice: 0,
    exportPriceDay: 0,
    exportPriceNight: 0,
    exportVat: 0,
    exportMilitary: 0,
    importPriceDay: 0,
    importPriceNight: 0,
    consumedPayment: 0,
    electricityPayment,
    electricitySavings,
    usdRate,
    roiUsd: electricitySavings / usdRate,
    isCommercial: true,
  }
}

describe('forecast calculations', () => {
  it('projects current month values and compares to previous month', () => {
    const forecast = calculateForecast({
      rows: [
        month({ date: '2026-05-01', production: 100, electricitySavings: 1_000, electricityPayment: 2_000, usdRate: 40 }),
        month({ date: '2026-06-01', production: 60, electricitySavings: 660, electricityPayment: 1_100, usdRate: 44 }),
      ],
      currency: 'UAH',
      today: new Date('2026-06-10T00:00:00'),
      projectMonthValue: (value) => value * 2,
    })

    expect(forecast?.production).toBe(120)
    expect(forecast?.productionDelta).toBe(20)
    expect(forecast?.roi).toBe(1320)
    expect(forecast?.roiDelta).toBe(320)
    expect(forecast?.income).toBe(2200)
    expect(forecast?.incomeDelta).toBe(200)
  })

  it('uses month rates for USD forecast values and deltas', () => {
    const forecast = calculateForecast({
      rows: [
        month({ date: '2026-05-01', production: 100, electricitySavings: 1_000, electricityPayment: 2_000, usdRate: 40 }),
        month({ date: '2026-06-01', production: 60, electricitySavings: 660, electricityPayment: 1_100, usdRate: 44 }),
      ],
      currency: 'USD',
      today: new Date('2026-06-10T00:00:00'),
      projectMonthValue: (value) => value * 2,
    })

    expect(forecast?.roi).toBe(30)
    expect(forecast?.roiDelta).toBe(5)
    expect(forecast?.income).toBe(50)
    expect(forecast?.incomeDelta).toBe(0)
  })

  it('uses production projection scale for ROI and income when available', () => {
    const forecast = calculateForecast({
      rows: [
        month({ date: '2026-05-01', production: 100, electricitySavings: 1_000, electricityPayment: 2_000, usdRate: 40 }),
        month({ date: '2026-06-01', production: 60, electricitySavings: 660, electricityPayment: 1_100, usdRate: 44 }),
      ],
      currency: 'UAH',
      today: new Date('2026-06-10T00:00:00'),
      projectMonthValue: (value) => value * 2,
      projectProductionValue: () => 180,
    })

    expect(forecast?.production).toBe(180)
    expect(forecast?.roi).toBe(1980)
    expect(forecast?.income).toBe(3300)
  })

  it('returns null without rows', () => {
    expect(calculateForecast({ rows: [], currency: 'UAH', projectMonthValue: (value) => value })).toBeNull()
  })
})
