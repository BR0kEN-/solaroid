import type { EnergySnapshot, PlantMetadata, Tariff } from './types'

export const PERCENT_DIVISOR = 100
export const ELECTRIC_HEATING_REGULAR_PRICE_MULTIPLIER = 4.32 / 2.64

export function consumedTotal(row: EnergySnapshot) {
  return row.consumedDay + row.consumedNight
}

export function importTotal(row: EnergySnapshot) {
  return row.importDay + row.importNight
}

export function exportTotal(row: EnergySnapshot) {
  return row.exportDay + row.exportNight
}

export function plantCapacityKwp(metadata?: PlantMetadata | null) {
  const watts = metadata?.pvs?.reduce((sum, field) => sum + field.power, 0) ?? 0
  return watts > 0 ? watts / 1000 : undefined
}

export function productionYieldKwhPerKwp(production: number, capacityKwp?: number) {
  if (!capacityKwp || capacityKwp <= 0) return undefined
  return production / capacityKwp
}

export function capacityDeltaPct(firstCapacityKwp?: number, secondCapacityKwp?: number) {
  if (!firstCapacityKwp || !secondCapacityKwp || secondCapacityKwp <= 0) return undefined
  return ((firstCapacityKwp - secondCapacityKwp) / secondCapacityKwp) * 100
}

export function capacityAdjustedProductionSurplus(
  firstProduction: number,
  secondProduction: number,
  firstCapacityKwp?: number,
  secondCapacityKwp?: number,
) {
  if (!firstCapacityKwp || !secondCapacityKwp || secondCapacityKwp <= 0) return undefined

  const expectedFirstProduction = secondProduction * (firstCapacityKwp / secondCapacityKwp)
  return firstProduction - expectedFirstProduction
}

export function balance(row: EnergySnapshot) {
  return importTotal(row) - exportTotal(row)
}

export function commercialBalance(row: EnergySnapshot, isCommercial: boolean) {
  return importTotal(row) - (isCommercial ? exportTotal(row) : 0)
}

export function exportTaxRate(tariff: Tariff) {
  return tariff.exportTaxes.reduce((sum, [, value]) => sum + value / PERCENT_DIVISOR, 0)
}

export function netExportPrice(tariff: Tariff) {
  return tariff.export * (1 - exportTaxRate(tariff))
}

export function netExportNightPrice(tariff: Tariff) {
  return tariff.exportNight * (1 - exportTaxRate(tariff))
}

export function exportPayout(row: EnergySnapshot, tariff: Tariff) {
  const surplus = Math.max(0, -commercialBalance(row, true))
  const totalExport = exportTotal(row)
  if (surplus <= 0 || totalExport <= 0) return 0

  const paidDay = surplus * (row.exportDay / totalExport)
  const paidNight = surplus - paidDay
  return paidDay * netExportPrice(tariff) + paidNight * netExportNightPrice(tariff)
}

function hasElectricHeatingTier(tariff: Tariff) {
  return Boolean(
    tariff.electricHeatingThresholdKwh &&
    tariff.electricHeatingThresholdKwh > 0,
  )
}

export function regularImportDayPrice(tariff: Tariff) {
  return hasElectricHeatingTier(tariff) ? tariff.importDay * ELECTRIC_HEATING_REGULAR_PRICE_MULTIPLIER : tariff.importDay
}

export function regularImportNightPrice(tariff: Tariff) {
  return hasElectricHeatingTier(tariff) ? tariff.importNight * ELECTRIC_HEATING_REGULAR_PRICE_MULTIPLIER : tariff.importNight
}

export interface ImportCostBreakdown {
  readonly discountedDay: number
  readonly discountedNight: number
  readonly regularDay: number
  readonly regularNight: number
  readonly discountedCost: number
  readonly regularCost: number
  readonly total: number
}

export function importCostBreakdown(importDay: number, importNight: number, tariff: Tariff): ImportCostBreakdown {
  const currentImportTotal = importDay + importNight
  if (currentImportTotal <= 0) {
    return {
      discountedDay: 0,
      discountedNight: 0,
      regularDay: 0,
      regularNight: 0,
      discountedCost: 0,
      regularCost: 0,
      total: 0,
    }
  }

  if (!hasElectricHeatingTier(tariff)) {
    const regularCost = importDay * tariff.importDay + importNight * tariff.importNight
    return {
      discountedDay: 0,
      discountedNight: 0,
      regularDay: importDay,
      regularNight: importNight,
      discountedCost: 0,
      regularCost,
      total: regularCost,
    }
  }

  const threshold = tariff.electricHeatingThresholdKwh ?? 0
  const regularTotal = Math.max(0, currentImportTotal - threshold)
  const dayShare = importDay / currentImportTotal
  const regularDay = regularTotal * dayShare
  const regularNight = regularTotal - regularDay
  const discountedDay = importDay - regularDay
  const discountedNight = importNight - regularNight
  const discountedCost =
    discountedDay * tariff.importDay +
    discountedNight * tariff.importNight
  const regularCost = regularDay * regularImportDayPrice(tariff) + regularNight * regularImportNightPrice(tariff)

  return {
    discountedDay,
    discountedNight,
    regularDay,
    regularNight,
    discountedCost,
    regularCost,
    total: discountedCost + regularCost,
  }
}

export function importEnergyCost(importDay: number, importNight: number, tariff: Tariff) {
  return importCostBreakdown(importDay, importNight, tariff).total
}

export function consumedPrice(row: EnergySnapshot, tariff: Tariff) {
  return importEnergyCost(row.consumedDay, row.consumedNight, tariff)
}

export function weightedImportPrice(row: EnergySnapshot, tariff: Tariff) {
  const currentImportTotal = importTotal(row)
  if (currentImportTotal <= 0) return tariff.importDay || tariff.importNight

  return importEnergyCost(row.importDay, row.importNight, tariff) / currentImportTotal
}

export function selfConsumed(row: EnergySnapshot) {
  return Math.max(0, row.production - exportTotal(row))
}

export function selfConsumptionSavings(row: EnergySnapshot, tariff: Tariff) {
  const measuredSelfConsumedDay = Math.max(0, row.consumedDay - row.importDay)
  const measuredSelfConsumedNight = Math.max(0, row.consumedNight - row.importNight)

  if (measuredSelfConsumedDay > 0 || measuredSelfConsumedNight > 0) {
    return consumedPrice(row, tariff) - importEnergyCost(row.importDay, row.importNight, tariff)
  }

  return selfConsumed(row) * weightedImportPrice(row, tariff)
}

export function payment(row: EnergySnapshot, tariff: Tariff, isCommercial = true) {
  const currentBalance = commercialBalance(row, isCommercial)

  if (currentBalance < 0) {
    return exportPayout(row, tariff)
  }

  const currentImportTotal = importTotal(row)
  if (currentImportTotal <= 0) return 0

  const paidExport = isCommercial ? exportTotal(row) : 0
  const coveredImportDay = paidExport * (row.importDay / currentImportTotal)
  const coveredImportNight = paidExport * (row.importNight / currentImportTotal)
  const remainingImportDay = row.importDay - coveredImportDay
  const remainingImportNight = row.importNight - coveredImportNight

  return -(
    importEnergyCost(remainingImportDay, remainingImportNight, tariff)
  )
}

export function savings(row: EnergySnapshot, tariff: Tariff, isCommercial = true) {
  if (!isCommercial) return selfConsumptionSavings(row, tariff)

  return consumedPrice(row, tariff) + payment(row, tariff, isCommercial)
}
