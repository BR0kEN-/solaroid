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

export function commercialBalance(row: EnergySnapshot, isCommercial: boolean) {
  return importTotal(row) - (isCommercial ? row.export : 0)
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

export function weightedImportPrice(row: EnergySnapshot, tariff: Tariff) {
  const currentImportTotal = importTotal(row)
  if (currentImportTotal <= 0) return tariff.importDay || tariff.importNight

  return (
    row.importDay * tariff.importDay +
    row.importNight * tariff.importNight
  ) / currentImportTotal
}

export function selfConsumed(row: EnergySnapshot) {
  return Math.max(0, row.production - row.export)
}

export function selfConsumptionSavings(row: EnergySnapshot, tariff: Tariff) {
  const measuredSelfConsumedDay = Math.max(0, row.consumedDay - row.importDay)
  const measuredSelfConsumedNight = Math.max(0, row.consumedNight - row.importNight)

  if (measuredSelfConsumedDay > 0 || measuredSelfConsumedNight > 0) {
    return measuredSelfConsumedDay * tariff.importDay + measuredSelfConsumedNight * tariff.importNight
  }

  return selfConsumed(row) * weightedImportPrice(row, tariff)
}

export function payment(row: EnergySnapshot, tariff: Tariff, isCommercial = true) {
  const currentBalance = commercialBalance(row, isCommercial)

  if (currentBalance < 0) {
    return Math.abs(currentBalance) * netExportPrice(tariff)
  }

  const currentImportTotal = importTotal(row)
  if (currentImportTotal <= 0) return 0

  const paidExport = isCommercial ? row.export : 0
  const coveredImportDay = paidExport * (row.importDay / currentImportTotal)
  const coveredImportNight = paidExport * (row.importNight / currentImportTotal)
  const remainingImportDay = row.importDay - coveredImportDay
  const remainingImportNight = row.importNight - coveredImportNight

  return -(
    remainingImportDay * tariff.importDay +
    remainingImportNight * tariff.importNight
  )
}

export function savings(row: EnergySnapshot, tariff: Tariff, isCommercial = true) {
  if (!isCommercial) return selfConsumptionSavings(row, tariff)

  return consumedPrice(row, tariff) + payment(row, tariff, isCommercial)
}
