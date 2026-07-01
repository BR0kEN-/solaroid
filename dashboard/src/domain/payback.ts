import { moneyFromUah, moneyFromUsd, sumRowsRoiMoney, type Currency } from './money'
import { importCostBreakdown, importEnergyCost, regularImportDayPrice, regularImportNightPrice } from './formulas'
import type { MonthRow, ProductionProjection, Tariff } from './types'

export interface PaybackResult {
  readonly recovered: number
  readonly progress: number
  readonly dailyAverage: number
  readonly remaining: number
  readonly daysLeft: number | null
  readonly payoffDuration: { readonly months: number; readonly days: number } | null
  readonly investment: number
  readonly investmentUsd: number
}

export interface CommercialEndRecoveryResult {
  readonly recovered: number
  readonly progress: number
  readonly roiDate: Date | null
  readonly roiDuration: { readonly months: number; readonly days: number } | null
  readonly roiRemainingDuration: { readonly months: number; readonly days: number } | null
  readonly roiPhase: 'commercial' | 'post-commercial' | null
  readonly details: CommercialRecoveryDetails | null
}

export interface CommercialRecoveryDetails {
  readonly annualProduction: {
    readonly kwh: number
    readonly source: 'pvgis' | 'all-time-data' | 'actual-fallback'
    readonly closedYearCount: number
  }
  readonly annualConsumption: {
    readonly dayKwh: number
    readonly nightKwh: number
    readonly totalKwh: number
    readonly dayValue: number
    readonly nightValue: number
    readonly totalValue: number
  }
  readonly annualSurplus: {
    readonly kwh: number
    readonly value: number
  }
  readonly commercialStartDate: Date
  readonly commercialEndDate: Date
}

const DEFAULT_ANNUAL_SELF_CONSUMPTION_KWH = 17_000
const SELF_CONSUMPTION_DAY_SHARE = 2 / 3
const ROI_FORECAST_MAX_YEARS = 60

export function calculatePayback({
  rows,
  investmentUsd,
  currency,
  launchUsdRate,
  launchDate,
  today = new Date(),
}: {
  readonly rows: readonly MonthRow[]
  readonly investmentUsd: number
  readonly currency: Currency
  readonly launchUsdRate: number
  readonly launchDate?: Date
  readonly today?: Date
}): PaybackResult | null {
  if (!investmentUsd) return null

  const investment = moneyFromUsd(investmentUsd, currency, launchUsdRate)
  const recovered = sumRowsRoiMoney(rows, currency)
  const remaining = Math.max(0, investment - recovered)
  const progress = Math.min(100, Math.max(0, (recovered / investment) * 100))
  const startDate = launchDate ?? rows[0]?.date
  const elapsedDays = startDate ? Math.max(1, daysBetween(startDate, today) + 1) : 0
  const dailyAverage = elapsedDays ? recovered / elapsedDays : 0
  const daysLeft = remaining <= 0 ? 0 : dailyAverage > 0 ? Math.ceil(remaining / dailyAverage) : null
  const payoffDuration = daysLeft === null ? null : fullDurationBetween(today, addDays(today, daysLeft))

  return { recovered, progress, dailyAverage, remaining, daysLeft, payoffDuration, investment, investmentUsd }
}

export function calculateCommercialEndRecovery({
  rows,
  payback,
  currency,
  commercialDate,
  launchDate,
  endDate,
  projection,
  today = new Date(),
}: {
  readonly rows: readonly MonthRow[]
  readonly payback: PaybackResult
  readonly currency: Currency
  readonly commercialDate?: Date
  readonly launchDate?: Date
  readonly endDate: Date
  readonly projection?: ProductionProjection | null
  readonly today?: Date
}): CommercialEndRecoveryResult {
  if (!commercialDate || !launchDate || endDate <= launchDate) {
    return progressResult(payback.recovered, payback.investment, null, launchDate ?? rows[0]?.date ?? new Date(), today, null)
  }

  return projectedRecovery({
    rows,
    launchDate,
    commercialDate,
    commercialEndDate: endDate,
    investment: payback.investment,
    currency,
    projection,
    today,
  })
}

function projectedRecovery({
  rows,
  launchDate,
  commercialDate,
  commercialEndDate,
  investment,
  currency,
  projection,
  today,
}: {
  readonly rows: readonly MonthRow[]
  readonly launchDate: Date
  readonly commercialDate: Date
  readonly commercialEndDate: Date
  readonly investment: number
  readonly currency: Currency
  readonly projection?: ProductionProjection | null
  readonly today: Date
}) {
  const forecastEnd = addMonths(commercialEndDate, ROI_FORECAST_MAX_YEARS * 12)
  const productionBasis = annualProductionBasis(rows, launchDate, projection, today)
  const consumptionBasis = annualConsumptionBasis(rows, launchDate, today)
  const details = commercialRecoveryDetails(rows, productionBasis, consumptionBasis, commercialDate, commercialEndDate, currency)
  let recovered = 0
  let recoveredAtCommercialEnd = 0
  let roiDate: Date | null = null

  for (const month of monthsBetween(launchDate, forecastEnd)) {
    const value = projectedMonthRecovery(rows, month, launchDate, commercialDate, commercialEndDate, forecastEnd, currency, productionBasis.kwh, consumptionBasis.totalKwh)

    if (month < commercialEndDate) {
      recoveredAtCommercialEnd += value
    }

    if (!roiDate && recovered + value >= investment && value > 0) {
      const remaining = investment - recovered
      const monthStartDate = monthStart(month)
      const monthEndDate = addMonths(monthStartDate, 1)
      const days = daysBetween(monthStartDate, monthEndDate)
      roiDate = addDays(monthStartDate, Math.ceil(days * (remaining / value)))
    }

    recovered += value
  }

  return progressResult(recoveredAtCommercialEnd, investment, roiDate, launchDate, today, details)
}

function projectedMonthRecovery(
  rows: readonly MonthRow[],
  month: Date,
  launchDate: Date,
  commercialDate: Date,
  commercialEndDate: Date,
  forecastEnd: Date,
  currency: Currency,
  annualProductionKwh: number,
  annualConsumptionKwh: number,
) {
  const rowsByMonth = new Map(rows.map((row) => [monthKey(row.date), row]))
  const activeShare = monthOverlapShare(month, launchDate, forecastEnd)
  if (activeShare <= 0) return 0

  const row = tariffRowForMonth(rows, month) ?? rowsByMonth.get(monthKey(month))
  if (!row) return 0

  const commercialShare = monthOverlapShare(month, commercialDate, commercialEndDate)
  const selfConsumption = (annualConsumptionKwh / 12) * activeShare
  const paidExport = annualPaidExport(annualProductionKwh, annualConsumptionKwh) / 12 * commercialShare
  const selfConsumptionDay = selfConsumption * SELF_CONSUMPTION_DAY_SHARE
  const selfConsumptionNight = selfConsumption - selfConsumptionDay
  const recovery =
    paidExport * netExportPrice(row) +
    importEnergyCost(selfConsumptionDay, selfConsumptionNight, tariffFromRow(row))

  return moneyFromUah(recovery, currency, row.usdRate)
}

function annualPaidExport(annualProduction: number, annualSelfConsumption: number) {
  return Math.max(0, annualProduction - annualSelfConsumption)
}

function progressResult(
  recovered: number,
  investment: number,
  roiDate: Date | null,
  launchDate: Date,
  today: Date,
  details: CommercialRecoveryDetails | null,
): CommercialEndRecoveryResult {
  const clamped = Math.min(investment, Math.max(0, recovered))
  return {
    recovered: clamped,
    progress: investment ? Math.min(100, Math.max(0, (clamped / investment) * 100)) : 0,
    roiDate,
    roiDuration: roiDate ? fullDurationBetween(launchDate, roiDate) : null,
    roiRemainingDuration: roiDate ? fullDurationBetween(today, roiDate) : null,
    roiPhase: roiDate ? (roiDate < new Date('2030-01-01T00:00:00') ? 'commercial' : 'post-commercial') : null,
    details,
  }
}

function annualProductionBasis(
  rows: readonly MonthRow[],
  launchDate: Date,
  projection: ProductionProjection | null | undefined,
  today: Date,
): CommercialRecoveryDetails['annualProduction'] {
  const allTimeProduction = annualizedAllTimeRows(rows, launchDate, today, (row) => row.production)
  if (allTimeProduction !== undefined) {
    return { kwh: allTimeProduction, source: 'all-time-data', closedYearCount: 0 }
  }

  const pvgisAnnual = projection?.monthlyKwh.reduce((sum, value) => sum + value, 0) ?? 0
  if (pvgisAnnual > 0) return { kwh: pvgisAnnual, source: 'pvgis', closedYearCount: 0 }

  return {
    kwh: rows.reduce((sum, row) => sum + row.production, 0),
    source: 'actual-fallback',
    closedYearCount: 0,
  }
}

function commercialRecoveryDetails(
  rows: readonly MonthRow[],
  production: CommercialRecoveryDetails['annualProduction'],
  consumptionBasis: Pick<CommercialRecoveryDetails['annualConsumption'], 'dayKwh' | 'nightKwh' | 'totalKwh'>,
  commercialStartDate: Date,
  commercialEndDate: Date,
  currency: Currency,
): CommercialRecoveryDetails {
  const consumption = annualConsumptionValue(rows, consumptionBasis, currency)
  return {
    annualProduction: production,
    annualConsumption: consumption,
    annualSurplus: {
      kwh: annualPaidExport(production.kwh, consumption.totalKwh),
      value: annualSurplusValue(rows, production.kwh, consumption.totalKwh, currency),
    },
    commercialStartDate,
    commercialEndDate,
  }
}

function annualConsumptionBasis(
  rows: readonly MonthRow[],
  launchDate: Date,
  today: Date,
): Pick<CommercialRecoveryDetails['annualConsumption'], 'dayKwh' | 'nightKwh' | 'totalKwh'> {
  const dayKwh = annualizedAllTimeRows(rows, launchDate, today, (row) => row.consumedDay)
  const nightKwh = annualizedAllTimeRows(rows, launchDate, today, (row) => row.consumedNight)
  if (dayKwh !== undefined && nightKwh !== undefined) {
    return { dayKwh, nightKwh, totalKwh: dayKwh + nightKwh }
  }

  return {
    dayKwh: DEFAULT_ANNUAL_SELF_CONSUMPTION_KWH * SELF_CONSUMPTION_DAY_SHARE,
    nightKwh: DEFAULT_ANNUAL_SELF_CONSUMPTION_KWH * (1 - SELF_CONSUMPTION_DAY_SHARE),
    totalKwh: DEFAULT_ANNUAL_SELF_CONSUMPTION_KWH,
  }
}

function annualConsumptionValue(
  rows: readonly MonthRow[],
  basis: Pick<CommercialRecoveryDetails['annualConsumption'], 'dayKwh' | 'nightKwh' | 'totalKwh'>,
  currency: Currency,
) {
  const monthlyDayKwh = basis.dayKwh / 12
  const monthlyNightKwh = basis.nightKwh / 12
  let dayValue = 0
  let nightValue = 0

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const row = tariffRowForMonthIndex(rows, monthIndex)
    if (!row) continue

    const breakdown = importCostBreakdown(monthlyDayKwh, monthlyNightKwh, tariffFromRow(row))
    const dayUah = breakdown.discountedDay * row.importPriceDay + breakdown.regularDay * regularImportDayPrice(tariffFromRow(row))
    const nightUah = breakdown.discountedNight * row.importPriceNight + breakdown.regularNight * regularImportNightPrice(tariffFromRow(row))
    dayValue += moneyFromUah(dayUah, currency, row.usdRate)
    nightValue += moneyFromUah(nightUah, currency, row.usdRate)
  }

  return {
    dayKwh: basis.dayKwh,
    nightKwh: basis.nightKwh,
    totalKwh: basis.totalKwh,
    dayValue,
    nightValue,
    totalValue: dayValue + nightValue,
  }
}

function annualSurplusValue(rows: readonly MonthRow[], annualProduction: number, annualConsumption: number, currency: Currency) {
  const monthlySurplus = annualPaidExport(annualProduction, annualConsumption) / 12
  let value = 0

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const row = tariffRowForMonthIndex(rows, monthIndex)
    if (!row) continue

    value += moneyFromUah(monthlySurplus * netExportPrice(row), currency, row.usdRate)
  }

  return value
}

function monthsBetween(start: Date, end: Date) {
  const months: Date[] = []
  for (let cursor = monthStart(start); cursor < end; cursor = addMonths(cursor, 1)) {
    months.push(cursor)
  }
  return months
}

function monthStart(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function monthKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function netExportPrice(row: MonthRow) {
  return row.exportPriceDay * (1 - taxFraction(row.exportVat) - taxFraction(row.exportMilitary))
}

function tariffFromRow(row: MonthRow): Tariff {
  return {
    importDay: row.importPriceDay,
    importNight: row.importPriceNight,
    electricHeatingThresholdKwh: row.electricHeatingThresholdKwh,
    export: row.exportPriceDay,
    exportNight: row.exportPriceNight,
    exportTaxes: [
      ['vat', row.exportVat],
      ['mil', row.exportMilitary],
    ],
  }
}

function taxFraction(value: number) {
  return value > 1 ? value / 100 : value
}

function tariffRowForMonth(rows: readonly MonthRow[], month: Date) {
  return [...rows]
    .reverse()
    .find((row) => row.date <= month && row.exportPriceDay > 0)
    ?? [...rows].reverse().find((row) => row.exportPriceDay > 0)
}

function tariffRowForMonthIndex(rows: readonly MonthRow[], monthIndex: number) {
  return [...rows]
    .reverse()
    .find((row) => row.date.getMonth() === monthIndex && row.exportPriceDay > 0)
    ?? [...rows].reverse().find((row) => row.exportPriceDay > 0)
}

function annualizedAllTimeRows(
  rows: readonly MonthRow[],
  launchDate: Date,
  today: Date,
  value: (row: MonthRow) => number,
) {
  const activeDays = daysBetween(launchDate, today)
  if (activeDays < 365) return undefined

  const total = rows
    .filter((row) => row.date >= monthStart(launchDate) && row.date <= today)
    .reduce((sum, row) => sum + value(row), 0)
  return total > 0 ? (total / activeDays) * 365 : undefined
}

function monthOverlapShare(month: Date, from: Date, to: Date) {
  const start = maxDate(monthStart(month), startOfDay(from))
  const end = minDate(addMonths(monthStart(month), 1), startOfDay(to))
  if (end <= start) return 0

  return daysBetween(start, end) / daysBetween(monthStart(month), addMonths(monthStart(month), 1))
}

function maxDate(first: Date, second: Date) {
  return first > second ? first : second
}

function minDate(first: Date, second: Date) {
  return first < second ? first : second
}

export function fullDurationBetween(start: Date, end: Date) {
  let months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth()
  if (end.getDate() < start.getDate()) months -= 1
  months = Math.max(0, months)

  const monthAnchor = new Date(start)
  monthAnchor.setMonth(start.getMonth() + months)
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  const days = Math.max(0, Math.floor((startOfDay(end).getTime() - startOfDay(monthAnchor).getTime()) / millisecondsPerDay))
  return { months, days }
}

export function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function daysBetween(start: Date, end: Date) {
  const millisecondsPerDay = 24 * 60 * 60 * 1000
  return Math.floor((startOfDay(end).getTime() - startOfDay(start).getTime()) / millisecondsPerDay)
}

export function addDays(date: Date, days: number) {
  const next = startOfDay(date)
  next.setDate(next.getDate() + days)
  return next
}

function addMonths(date: Date, months: number) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}
