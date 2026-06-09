import { moneyFromUah, moneyFromUsd, sumRowsRoiMoney, type Currency } from './money'
import type { MonthRow } from './types'

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

  const investmentUah = moneyFromUsd(investmentUsd, 'UAH', launchUsdRate)
  const recoveredUah = sumRowsRoiMoney(rows, 'UAH')
  const remainingUah = Math.max(0, investmentUah - recoveredUah)
  const investment = moneyFromUah(investmentUah, currency, launchUsdRate)
  const recovered = moneyFromUah(recoveredUah, currency, launchUsdRate)
  const remaining = moneyFromUah(remainingUah, currency, launchUsdRate)
  const progress = Math.min(100, Math.max(0, (recoveredUah / investmentUah) * 100))
  const startDate = launchDate ?? rows[0]?.date
  const elapsedDays = startDate ? Math.max(1, daysBetween(startDate, today) + 1) : 0
  const dailyAverageUah = elapsedDays ? recoveredUah / elapsedDays : 0
  const dailyAverage = moneyFromUah(dailyAverageUah, currency, launchUsdRate)
  const daysLeft = remainingUah <= 0 ? 0 : dailyAverageUah > 0 ? Math.ceil(remainingUah / dailyAverageUah) : null
  const payoffDuration = daysLeft === null ? null : fullDurationBetween(today, addDays(today, daysLeft))

  return { recovered, progress, dailyAverage, remaining, daysLeft, payoffDuration, investment, investmentUsd }
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
