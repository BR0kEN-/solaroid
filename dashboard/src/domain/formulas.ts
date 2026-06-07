import type { EnergySnapshot, Tariff } from './types'

export const PERCENT_DIVISOR = 100

export function consumedTotal(row: EnergySnapshot) {
  return row.consumedDay + row.consumedNight
}

export function importTotal(row: EnergySnapshot) {
  return row.importDay + row.importNight
}

export function balance(row: EnergySnapshot) {
  return importTotal(row) - row.export
}

export function exportTaxRate(tariff: Tariff) {
  return tariff.exportTaxes.reduce((sum, [, value]) => sum + value / PERCENT_DIVISOR, 0)
}

export function netExportPrice(tariff: Tariff) {
  return tariff.export * (1 - exportTaxRate(tariff))
}

export function consumedPrice(row: EnergySnapshot, tariff: Tariff) {
  return row.consumedDay * tariff.importDay + row.consumedNight * tariff.importNight
}

export function payment(row: EnergySnapshot, tariff: Tariff) {
  const currentBalance = balance(row)

  if (currentBalance < 0) {
    return Math.abs(currentBalance) * netExportPrice(tariff)
  }

  const currentImportTotal = importTotal(row)
  if (currentImportTotal <= 0) return 0

  const coveredImportDay = row.export * (row.importDay / currentImportTotal)
  const coveredImportNight = row.export * (row.importNight / currentImportTotal)
  const remainingImportDay = row.importDay - coveredImportDay
  const remainingImportNight = row.importNight - coveredImportNight

  return -(
    remainingImportDay * tariff.importDay +
    remainingImportNight * tariff.importNight
  )
}

export function savings(row: EnergySnapshot, tariff: Tariff) {
  return consumedPrice(row, tariff) + payment(row, tariff)
}
