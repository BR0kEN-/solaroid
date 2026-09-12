export interface MonthRow {
  readonly month: string
  readonly date: Date
  readonly production: number
  readonly exportDay: number
  readonly exportNight: number
  readonly importDay: number
  readonly importNight: number
  readonly consumedDay: number
  readonly consumedNight: number
  readonly lossesDay?: number
  readonly lossesNight?: number
  readonly consumedTotal: number
  readonly importTotal: number
  readonly balance: number
  readonly exportPrice: number
  readonly exportPriceDay: number
  readonly exportPriceNight: number
  readonly exportPersonalIncomeTax: number
  readonly exportMilitary: number
  readonly importPriceDay: number
  readonly importPriceNight: number
  readonly electricHeatingThresholdKwh?: number
  readonly consumedPayment: number
  readonly electricityPayment: number
  readonly electricitySavings: number
  readonly usdRate: number
  readonly roiUsd: number
  readonly isCommercial: boolean
  readonly utilityMeter?: UtilityMeterReconciliation
  readonly receipt?: MonthReceipt
}

export interface MonthTariffScenario {
  readonly netExportDayUahPerKwh: number
  readonly importDayUahPerKwh: number
  readonly importNightUahPerKwh: number
  readonly usdRate: number
}

export type PlantSpendingType = 'damage_replacement'

export interface PlantSpending {
  readonly id: number
  readonly date: Date
  readonly type: PlantSpendingType
  readonly amountUsd: number
}

export interface MonthReceipt {
  readonly id?: string
  readonly path: string
  readonly filename: string
  readonly contentType: string
  readonly sizeBytes: number
  readonly report?: GreenTariffReport
}

export interface GreenTariffReport {
  readonly account: string
  readonly eic: string
  readonly actDate: string
  readonly energy: GreenTariffEnergy
  readonly purchase: GreenTariffPurchase
  readonly payment: GreenTariffPayment
}

export interface GreenTariffEnergy {
  readonly grid: GreenTariffEnergyFlow
  readonly payable: GreenTariffPayableEnergy
}

export interface GreenTariffEnergyFlow {
  readonly importKwh: number
  readonly exportKwh: number
}

export interface GreenTariffPayableEnergy {
  readonly consumerKwh: number
  readonly supplierKwh: number
}

export interface GreenTariffPurchase {
  readonly greenTariff: GreenTariffPurchaseRow
  readonly weightedPrice: GreenTariffPurchaseRow
}

export interface GreenTariffPurchaseRow {
  readonly kwh: number
  readonly priceKopPerKwh: number
  readonly amountUah: number
}

export interface GreenTariffPayment {
  readonly grossUah: number
  readonly taxes: GreenTariffTaxes
  readonly netUah: number
}

export interface GreenTariffTaxes {
  readonly personalIncomeUah: number
  readonly militaryLevyUah: number
}

export interface GreenTariffReconciliationValue {
  readonly receipt: number
  readonly solaroid: number
  readonly delta: number
  readonly deltaPercent?: number
}

export interface GreenTariffReconciliationSummary {
  readonly netUah: number
  readonly supplierPayableKwh: number
  readonly withheldUah: number
  readonly effectiveGrossUahPerKwh?: number
  readonly effectiveNetUahPerKwh?: number
  readonly withheldTaxPercent?: number
}

export interface GreenTariffReceiptArithmetic {
  readonly supplierPayableKwh: GreenTariffReconciliationValue
  readonly greenTariffAmountUah: GreenTariffReconciliationValue
  readonly weightedPriceAmountUah: GreenTariffReconciliationValue
  readonly grossUah: GreenTariffReconciliationValue
  readonly netUah: GreenTariffReconciliationValue
}

export interface GreenTariffReceiptReconciliation {
  readonly summary: GreenTariffReconciliationSummary
  readonly energySource: 'utility-meter' | 'home-assistant'
  readonly grid: {
    readonly importKwh: GreenTariffReconciliationValue
    readonly exportKwh: GreenTariffReconciliationValue
  }
  readonly payable: {
    readonly consumerKwh: GreenTariffReconciliationValue
    readonly supplierKwh: GreenTariffReconciliationValue
  }
  readonly settlement: {
    readonly grossUah: GreenTariffReconciliationValue
    readonly netUah: GreenTariffReconciliationValue
  }
  readonly taxes: {
    readonly personalIncomeUah: GreenTariffReconciliationValue
    readonly militaryLevyUah: GreenTariffReconciliationValue
  }
  readonly arithmetic: GreenTariffReceiptArithmetic
}

export interface UtilityMeterReconciliation {
  readonly ha: {
    readonly importDay: number
    readonly importNight: number
    readonly exportDay: number
    readonly exportNight: number
  }
  readonly utility: {
    readonly importDay: number
    readonly importNight: number
    readonly exportDay: number
    readonly exportNight: number
  }
  readonly records?: UtilityMeterRecordDates
}

export interface UtilityMeterRecordDates {
  readonly current: string
  readonly previous: string
}

export interface DataState {
  readonly plantId: string
  readonly rows: readonly MonthRow[]
  readonly dailyRows: readonly MonthRow[]
  readonly readablePlantIds: readonly string[]
  readonly readablePlantScopes: Readonly<Record<string, readonly string[]>>
  readonly scopes: readonly string[]
  readonly investmentUsd: number
  readonly spendings: readonly PlantSpending[]
  readonly launchDate?: Date
  readonly commercialDate?: Date
  readonly metadata?: PlantMetadata | null
  readonly projection?: ProductionProjection | null
  readonly sheetUpdatedAt?: Date
  readonly isLoading: boolean
  readonly updatedAt: Date
  readonly error?: string
}

export type LoadedData = Omit<DataState, 'isLoading' | 'updatedAt' | 'error'>

export interface PlantComparison {
  readonly plantId: string
  readonly rows: readonly MonthRow[]
  readonly dailyRows: readonly MonthRow[]
  readonly scopes: readonly string[]
  readonly investmentUsd: number
  readonly launchDate?: Date
  readonly commercialDate?: Date
  readonly metadata?: PlantMetadata | null
  readonly projection?: ProductionProjection | null
  readonly sheetUpdatedAt?: Date
}

export type ExportTax = readonly [type: string, value: number]

export interface Tariff {
  readonly importDay: number
  readonly importNight: number
  readonly electricHeatingThresholdKwh?: number
  readonly export: number
  readonly exportNight: number
  readonly exportTaxes: readonly ExportTax[]
}

export interface EnergySnapshot {
  readonly production: number
  readonly exportDay: number
  readonly exportNight: number
  readonly importDay: number
  readonly importNight: number
  readonly consumedDay: number
  readonly consumedNight: number
}

export interface PvMetadata {
  readonly azimuth: number
  readonly power: number
  readonly slope: number
  readonly elevation: number
  readonly lat: number
  readonly lng: number
  readonly loss: number
  readonly mounting: string
}

export interface PlantMetadata {
  readonly pvs?: readonly PvMetadata[]
}

export interface ProductionProjection {
  readonly monthlyKwh: readonly number[]
  readonly dailyKwh: readonly number[]
}
