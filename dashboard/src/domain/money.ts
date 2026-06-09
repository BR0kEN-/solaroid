import type { MonthRow } from './types'

export type Currency = 'UAH' | 'USD'

export function moneyFromUah(value: number, currency: Currency, usdRate: number) {
  if (currency === 'UAH') return value
  return usdRate ? value / usdRate : 0
}

export function moneyFromUsd(value: number, currency: Currency, usdRate: number) {
  if (currency === 'USD') return value
  return value * usdRate
}

export function rowRoiMoney(row: MonthRow, currency: Currency) {
  if (currency === 'UAH') return row.electricitySavings
  return row.roiUsd || moneyFromUah(row.electricitySavings, currency, row.usdRate)
}

export function rowPaybackMoney(row: MonthRow, currency: Currency, usdRate: number) {
  return moneyFromUah(row.electricitySavings, currency, usdRate)
}

export function sumRowsFromUah(rows: readonly MonthRow[], selector: (row: MonthRow) => number, currency: Currency) {
  return rows.reduce((sum, row) => sum + moneyFromUah(selector(row), currency, row.usdRate), 0)
}

export function sumRowsRoiMoney(rows: readonly MonthRow[], currency: Currency) {
  return rows.reduce((sum, row) => sum + rowRoiMoney(row, currency), 0)
}
