import { moneyFromUah, rowRoiMoney, type Currency } from './money'
import type { MonthRow } from './types'

export interface ForecastResult {
  readonly row: MonthRow
  readonly previousRow?: MonthRow
  readonly production: number
  readonly productionDelta: number
  readonly roi: number
  readonly roiDelta: number
  readonly income: number
  readonly incomeDelta: number
}

export function calculateForecast({
  rows,
  currency,
  today = new Date(),
  projectMonthValue,
}: {
  readonly rows: readonly MonthRow[]
  readonly currency: Currency
  readonly today?: Date
  readonly projectMonthValue: (value: number, date: Date) => number
}): ForecastResult | null {
  const currentMonthRow = rows.find((row) => sameMonth(row.date, today)) ?? rows.at(-1)
  if (!currentMonthRow) return null

  const currentIndex = rows.findIndex((row) => sameMonth(row.date, currentMonthRow.date))
  const previousMonthRow = currentIndex > 0 ? rows[currentIndex - 1] : undefined
  const production = projectMonthValue(currentMonthRow.production, currentMonthRow.date)
  const roi = projectMonthValue(rowRoiMoney(currentMonthRow, currency), currentMonthRow.date)
  const income = projectMonthValue(moneyFromUah(currentMonthRow.electricityPayment, currency, currentMonthRow.usdRate), currentMonthRow.date)
  const previousRoi = previousMonthRow ? rowRoiMoney(previousMonthRow, currency) : 0
  const previousIncome = previousMonthRow ? moneyFromUah(previousMonthRow.electricityPayment, currency, previousMonthRow.usdRate) : 0

  return {
    row: currentMonthRow,
    previousRow: previousMonthRow,
    production,
    productionDelta: previousMonthRow ? production - previousMonthRow.production : 0,
    roi,
    roiDelta: previousMonthRow ? roi - previousRoi : 0,
    income,
    incomeDelta: previousMonthRow ? income - previousIncome : 0,
  }
}

function sameMonth(first: Date, second: Date) {
  return first.getFullYear() === second.getFullYear() && first.getMonth() === second.getMonth()
}
