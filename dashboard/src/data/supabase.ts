import { API_URL } from '../config'
import { balance, consumedPrice, consumedTotal, importTotal, payment, savings } from '../domain/formulas'
import type { EnergySnapshot, ExportTax, LoadedData, MonthRow, PlantComparison, Tariff } from '../domain/types'

interface PlantRecord {
  readonly id: string
  readonly investment_usd: number
  readonly launch_date: string
  readonly commercial_date: string
  readonly updated_at?: string
}

interface MonthRecord {
  readonly plant_id: string
  readonly date: string
  readonly production: number
  readonly export: number
  readonly import_day: number
  readonly import_night: number
  readonly consumption_day: number
  readonly consumption_night: number
  readonly updated_at?: string
}

interface DayRecord extends MonthRecord {
  readonly uah_usd_rate: number
  readonly uah_eur_rate: number
}

interface TariffRecord {
  readonly plant_id: string
  readonly date: string
  readonly price_import_day: number
  readonly price_import_night: number
  readonly price_export: number
  readonly export_taxes: readonly ExportTax[]
  readonly updated_at?: string
}

interface ApiResponse {
  readonly ok: boolean
  readonly message?: string
  readonly plant?: PlantRecord
  readonly days?: readonly DayRecord[]
  readonly months?: readonly MonthRecord[]
  readonly tariffs?: readonly TariffRecord[]
  readonly reads?: readonly string[]
}

export async function loadDashboardData(): Promise<LoadedData> {
  assertConfig()

  const { plant, months, days, tariffs, reads } = await fetchDashboardData()
  const loaded = toLoadedPlant({ plant, months, days, tariffs })

  return {
    ...loaded,
    readablePlantIds: reads,
  }
}

export async function loadPlantData(plantId: string): Promise<PlantComparison> {
  assertConfig()

  const { plant, months, days, tariffs } = await fetchDashboardData(plantId)

  return toLoadedPlant({ plant, months, days, tariffs })
}

export async function loadPlantDateRange(plantId: string, from: string, to = from): Promise<PlantComparison> {
  assertConfig()

  const { plant, months, days, tariffs } = await fetchDashboardData(plantId, { from, to })

  return toLoadedPlant({ plant, months, days, tariffs })
}

function toLoadedPlant({
  plant,
  months,
  days,
  tariffs,
}: {
  readonly plant: PlantRecord
  readonly months: readonly MonthRecord[]
  readonly days: readonly DayRecord[]
  readonly tariffs: readonly TariffRecord[]
}): PlantComparison {
  const monthlyRates = averageUsdRateByMonth(days)
  const fallbackUsdRate = latestPositiveRate(days)
  const tariffByMonth = new Map(tariffs.map((tariff) => [tariff.date, tariff]))
  const commercialDate = parseDate(plant.commercial_date)
  const rows = months.map((month) => toMonthRow(month, tariffByMonth.get(month.date), monthlyRates.get(month.date) ?? fallbackUsdRate, commercialDate))
  const dailyRows = days.map((day) => toDailyRow(day, tariffByMonth.get(monthDate(day.date)), commercialDate))

  return {
    plantId: plant.id,
    rows,
    dailyRows,
    investmentUsd: plant.investment_usd,
    launchDate: parseDate(plant.launch_date),
    commercialDate,
    sheetUpdatedAt: latestUpdatedAt([plant.updated_at, ...months.map((row) => row.updated_at), ...days.map((row) => row.updated_at), ...tariffs.map((row) => row.updated_at)]),
  }
}

function assertConfig() {
  if (!API_URL) throw new Error('VITE_API_URL is not configured')
  if (!accessToken()) throw new Error('VITE_ACCESS_TOKEN is not configured and no token was provided in the URL hash')
}

async function fetchDashboardData(
  plantIdOverride?: string,
  range?: {
    readonly from: string
    readonly to: string
  },
) {
  const currentPlantId = plantIdOverride ?? plantId()
  const url = new URL(API_URL)
  if (currentPlantId) url.searchParams.set('plant', currentPlantId)
  if (range) {
    url.searchParams.set('from', range.from)
    url.searchParams.set('to', range.to)
  }

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken()}`,
    },
  })

  if (!response.ok) {
    const message = await response.text()
    throw new Error(`Dashboard API load failed: ${response.status} ${message}`)
  }

  const data = await response.json() as ApiResponse

  if (!data.ok) {
    throw new Error(data.message ?? 'Dashboard API returned an error')
  }

  if (!data.plant) {
    throw new Error(currentPlantId ? `Plant "${currentPlantId}" was not returned` : 'Default plant was not returned')
  }

  return {
    plant: data.plant,
    days: data.days ?? [],
    months: data.months ?? [],
    tariffs: data.tariffs ?? [],
    reads: data.reads ?? [],
  }
}

function plantId() {
  return queryParam('plant')
}

function accessToken() {
  return tokenFromHash()
}

function tokenFromHash() {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token') ?? ''
}

function queryParam(name: string) {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get(name) ?? ''
}

function toMonthRow(row: MonthRecord, tariffRecord: TariffRecord | undefined, usdRate: number, commercialDate: Date): MonthRow {
  const tariff = toTariff(tariffRecord)
  return toDashboardRow({
    row,
    tariff,
    usdRate,
    date: parseDate(row.date),
    month: displayMonth(row.date),
    commercialDate,
  })
}

function toDailyRow(row: DayRecord, tariffRecord: TariffRecord | undefined, commercialDate: Date): MonthRow {
  const tariff = toTariff(tariffRecord)
  return toDashboardRow({
    row,
    tariff,
    usdRate: row.uah_usd_rate,
    date: parseDate(row.date),
    month: row.date,
    commercialDate,
  })
}

function toDashboardRow({
  row,
  tariff,
  usdRate,
  date,
  month,
  commercialDate,
}: {
  readonly row: MonthRecord
  readonly tariff: Tariff
  readonly usdRate: number
  readonly date: Date
  readonly month: string
  readonly commercialDate: Date
}): MonthRow {
  const snapshot = toSnapshot(row)
  const isCommercial = date >= commercialDate
  const rowConsumedPrice = consumedPrice(snapshot, tariff)
  const rowPayment = payment(snapshot, tariff, isCommercial)
  const rowSavings = savings(snapshot, tariff, isCommercial)

  return {
    month,
    date,
    production: row.production,
    export: row.export,
    importDay: row.import_day,
    importNight: row.import_night,
    consumedDay: row.consumption_day,
    consumedNight: row.consumption_night,
    consumedTotal: consumedTotal(snapshot),
    importTotal: importTotal(snapshot),
    balance: balance(snapshot),
    exportPrice: tariff.export,
    exportVat: taxValue(tariff.exportTaxes, 'vat'),
    exportMilitary: taxValue(tariff.exportTaxes, 'mil'),
    importPriceDay: tariff.importDay,
    importPriceNight: tariff.importNight,
    consumedPayment: rowConsumedPrice,
    electricityPayment: rowPayment,
    electricitySavings: rowSavings,
    usdRate,
    roiUsd: usdRate ? rowSavings / usdRate : 0,
    isCommercial,
  }
}

function toSnapshot(row: MonthRecord): EnergySnapshot {
  return {
    production: row.production,
    export: row.export,
    importDay: row.import_day,
    importNight: row.import_night,
    consumedDay: row.consumption_day,
    consumedNight: row.consumption_night,
  }
}

function toTariff(row: TariffRecord | undefined): Tariff {
  return {
    importDay: row?.price_import_day ?? 0,
    importNight: row?.price_import_night ?? 0,
    export: row?.price_export ?? 0,
    exportTaxes: row?.export_taxes ?? [],
  }
}

function averageUsdRateByMonth(days: readonly DayRecord[]) {
  const rates = new Map<string, { sum: number; count: number }>()
  days.forEach((day) => {
    if (day.uah_usd_rate <= 0) return
    const key = monthDate(day.date)
    const current = rates.get(key) ?? { sum: 0, count: 0 }
    rates.set(key, { sum: current.sum + day.uah_usd_rate, count: current.count + 1 })
  })
  return new Map([...rates].map(([key, value]) => [key, value.sum / value.count]))
}

function latestPositiveRate(days: readonly DayRecord[]) {
  return [...days].reverse().find((day) => day.uah_usd_rate > 0)?.uah_usd_rate ?? 1
}

function monthDate(date: string) {
  return `${date.slice(0, 7)}-01`
}

function displayMonth(date: string) {
  return `${date.slice(5, 7)}.${date.slice(0, 4)}`
}

function parseDate(date: string) {
  return new Date(`${date}T00:00:00`)
}

function taxValue(taxes: readonly ExportTax[], type: string) {
  return taxes.find(([taxType]) => taxType === type)?.[1] ?? 0
}

function latestUpdatedAt(values: Array<string | undefined>) {
  const latest = values
    .filter((value): value is string => Boolean(value))
    .map((value) => new Date(value))
    .filter((value) => !Number.isNaN(value.getTime()))
    .sort((a, b) => b.getTime() - a.getTime())[0]

  return latest
}
