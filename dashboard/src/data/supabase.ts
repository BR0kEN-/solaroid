import { API_URL } from '../config'
import { balance, consumedPrice, consumedTotal, importTotal, payment, savings } from '../domain/formulas'
import type { EnergySnapshot, ExportTax, LoadedData, MonthRow, PlantComparison, Tariff } from '../domain/types'

interface PlantRecord {
  readonly id: string
  readonly investment_usd: number
  readonly launch_date: string
  readonly commercial_date: string
  readonly electric_heating_import_threshold_kwh?: number | null
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
  readonly uah_usd_rate?: number | null
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
  readonly records?: readonly DayRecord[] | readonly MonthRecord[]
}

interface DashboardAccess {
  readonly apiUrl?: string
  readonly plantId?: string
  readonly token?: string
}

let dashboardAccess: DashboardAccess = {}

export function configureDashboardAccess(next: DashboardAccess) {
  dashboardAccess = next
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

export async function loadPlantGranularity(plantId: string, granularity: string): Promise<PlantComparison> {
  assertConfig()

  const { plant, records, tariffs } = await fetchDashboardData(plantId, granularity)
  const isDayGranularity = /^\d{4}-\d{2}-\d{2}$/.test(granularity)

  return toLoadedPlant({
    plant,
    months: isDayGranularity ? [] : records as readonly MonthRecord[],
    days: isDayGranularity ? records as readonly DayRecord[] : [],
    tariffs,
  })
}

export function toLoadedPlant({
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
  const monthlyRates = latestUsdRateByMonth(days)
  const fallbackUsdRate = latestPositiveRate(days)
  const tariffByMonth = new Map(tariffs.map((tariff) => [tariff.date, tariff]))
  const commercialDate = parseDate(plant.commercial_date)
  const electricHeatingThresholdKwh = plant.electric_heating_import_threshold_kwh ?? undefined
  const rows = months.map((month) => toMonthRow(month, tariffByMonth.get(month.date), monthUsdRate(month, monthlyRates, fallbackUsdRate), commercialDate, electricHeatingThresholdKwh))
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
  if (!apiUrl()) throw new Error('VITE_SUPABASE_URL is not configured')
  if (!accessToken()) throw new Error('No token was provided in the URL hash')
}

async function fetchDashboardData(
  plantIdOverride?: string,
  granularity?: string,
) {
  const currentPlantId = plantIdOverride ?? plantId()
  const url = new URL(apiUrl())
  if (currentPlantId) url.searchParams.set('plant', currentPlantId)
  if (granularity) url.searchParams.set('granularity', granularity)

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
    records: data.records ?? [],
    tariffs: data.tariffs ?? [],
    reads: data.reads ?? [],
  }
}

function plantId() {
  if (dashboardAccess.plantId) return dashboardAccess.plantId

  return queryParam('plant')
}

function accessToken() {
  if (dashboardAccess.token) return dashboardAccess.token

  return tokenFromHash()
}

function apiUrl() {
  return dashboardAccess.apiUrl ?? API_URL
}

function tokenFromHash() {
  if (typeof window === 'undefined') return ''

  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
  return params.get('access_token') ?? params.get('token') ?? ''
}

function queryParam(name: string) {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get(name) ?? ''
}

function toMonthRow(row: MonthRecord, tariffRecord: TariffRecord | undefined, usdRate: number, commercialDate: Date, electricHeatingThresholdKwh?: number): MonthRow {
  const tariff = toTariff(tariffRecord, electricHeatingSeasonThreshold(row.date, electricHeatingThresholdKwh))
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
    electricHeatingThresholdKwh: tariff.electricHeatingThresholdKwh,
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

function toTariff(row: TariffRecord | undefined, electricHeatingThresholdKwh?: number): Tariff {
  return {
    importDay: row?.price_import_day ?? 0,
    importNight: row?.price_import_night ?? 0,
    electricHeatingThresholdKwh,
    export: row?.price_export ?? 0,
    exportTaxes: row?.export_taxes ?? [],
  }
}

function electricHeatingSeasonThreshold(date: string, threshold?: number) {
  if (!threshold || threshold <= 0) return undefined

  const month = Number(date.slice(5, 7))
  return month >= 10 || month <= 4 ? threshold : undefined
}

function latestUsdRateByMonth(days: readonly DayRecord[]) {
  const rates = new Map<string, number>()
  days.forEach((day) => {
    if (day.uah_usd_rate <= 0) return
    rates.set(monthDate(day.date), day.uah_usd_rate)
  })
  return rates
}

function latestPositiveRate(days: readonly DayRecord[]) {
  return [...days].reverse().find((day) => day.uah_usd_rate > 0)?.uah_usd_rate ?? 1
}

function monthUsdRate(row: MonthRecord, dailyRates: ReadonlyMap<string, number>, fallbackUsdRate: number) {
  const dailyRate = dailyRates.get(row.date)
  if (dailyRate && dailyRate > 0) return dailyRate
  if (row.uah_usd_rate && row.uah_usd_rate > 0) return row.uah_usd_rate
  return fallbackUsdRate
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
