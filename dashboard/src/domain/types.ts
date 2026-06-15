export interface MonthRow {
  readonly month: string
  readonly date: Date
  readonly production: number
  readonly export: number
  readonly importDay: number
  readonly importNight: number
  readonly consumedDay: number
  readonly consumedNight: number
  readonly consumedTotal: number
  readonly importTotal: number
  readonly balance: number
  readonly exportPrice: number
  readonly exportVat: number
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
}

export interface DataState {
  readonly plantId: string
  readonly rows: readonly MonthRow[]
  readonly dailyRows: readonly MonthRow[]
  readonly readablePlantIds: readonly string[]
  readonly investmentUsd: number
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
  readonly exportTaxes: readonly ExportTax[]
}

export interface EnergySnapshot {
  readonly production: number
  readonly export: number
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
