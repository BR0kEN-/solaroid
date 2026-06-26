import { API_URL } from '../config'
import { balance, consumedPrice, consumedTotal, importTotal, payment, savings } from '../domain/formulas'
import type { EnergySnapshot, ExportTax, LoadedData, MonthRow, PlantComparison, PlantMetadata, ProductionProjection, Tariff } from '../domain/types'

interface PlantRecord {
  readonly id: string
  readonly metadata?: PlantMetadata | null
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
  readonly export_day: number
  readonly export_night: number
  readonly import_day: number
  readonly import_night: number
  readonly consumption_day: number
  readonly consumption_night: number
  readonly uah_usd_rate?: number | null
  readonly utility_import_day?: number | null
  readonly utility_import_night?: number | null
  readonly utility_export_day?: number | null
  readonly utility_export_night?: number | null
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
  readonly price_export_day: number
  readonly price_export_night: number
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
  readonly reads?: Readonly<Record<string, readonly string[]>> | readonly string[]
  readonly records?: readonly DayRecord[] | readonly MonthRecord[]
  readonly projection?: ProductionProjection | null
}

interface DashboardAccess {
  readonly apiUrl?: string
  readonly plantId?: string
  readonly token?: string
  readonly tokenKind?: AccessTokenKind
}

type AccessTokenKind = 'ingest' | 'auth'

let dashboardAccess: DashboardAccess = {}
const FULL_ACCESS_SCOPES = ['loc'] as const

export function configureDashboardAccess(next: DashboardAccess) {
  dashboardAccess = next
}

export async function loadDashboardData(): Promise<LoadedData> {
  assertConfig()

  const { plant, months, days, tariffs, reads, projection } = await fetchDashboardData()
  const readablePlantScopes = normalizeReadablePlantScopes(reads)
  const loaded = toLoadedPlant({ plant, months, days, tariffs, projection })

  return {
    ...loaded,
    readablePlantIds: readablePlantIds(readablePlantScopes, plant.id),
    readablePlantScopes,
    scopes: currentPlantScopes(readablePlantScopes, plant.id),
  }
}

export async function loadPlantData(plantId: string): Promise<PlantComparison> {
  assertConfig()

  const { plant, months, days, tariffs, projection } = await fetchDashboardData(plantId)

  return toLoadedPlant({ plant, months, days, tariffs, projection })
}

export async function loadPlantGranularity(plantId: string, granularity: string): Promise<PlantComparison> {
  assertConfig()

  const { plant, records, tariffs, projection } = await fetchDashboardData(plantId, granularity)
  const isDayGranularity = /^\d{4}-\d{2}-\d{2}$/.test(granularity)
  const days = isDayGranularity
    ? records as readonly DayRecord[]
    : /^\d{4}$/.test(granularity)
      ? (await fetchDashboardData(plantId)).days
      : []

  return toLoadedPlant({
    plant,
    months: isDayGranularity ? [] : records as readonly MonthRecord[],
    days,
    tariffs,
    projection,
  })
}

export function toLoadedPlant({
  plant,
  months,
  days,
  tariffs,
  projection,
}: {
  readonly plant: PlantRecord
  readonly months: readonly MonthRecord[]
  readonly days: readonly DayRecord[]
  readonly tariffs: readonly TariffRecord[]
  readonly projection?: ProductionProjection | null
}): PlantComparison {
  const monthlyRates = latestUsdRateByMonth(days)
  const fallbackUsdRate = latestPositiveRate(days)
  const tariffByMonth = new Map(tariffs.map((tariff) => [tariff.date, tariff]))
  const commercialDate = parseDate(plant.commercial_date)
  const electricHeatingThresholdKwh = plant.electric_heating_import_threshold_kwh ?? undefined
  const adjustedDays = applyUtilityMeterToDays(days, utilityTargetsByMonth(months))
  const dailyRows = adjustedDays.map((day) => toDailyRow(day, tariffByMonth.get(monthDate(day.date)), commercialDate))
  const dailyRowsByMonth = groupDailyRowsByMonth(dailyRows)
  const rows = months.map((month) => toMonthRow(
    month,
    tariffByMonth.get(month.date),
    monthUsdRate(month, monthlyRates, fallbackUsdRate),
    commercialDate,
    electricHeatingThresholdKwh,
    dailyRowsByMonth.get(month.date),
  ))

  return {
    plantId: plant.id,
    rows,
    dailyRows,
    scopes: [],
    investmentUsd: plant.investment_usd,
    launchDate: parseDate(plant.launch_date),
    commercialDate,
    metadata: plant.metadata ?? null,
    projection: projection ?? null,
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
    reads: data.reads ?? {},
    projection: data.projection ?? null,
  }
}

function normalizeReadablePlantScopes(reads: Readonly<Record<string, readonly string[]>> | readonly string[]): Readonly<Record<string, readonly string[]>> {
  if (Array.isArray(reads)) {
    return Object.fromEntries(reads.map((plantId) => [plantId, []])) as Readonly<Record<string, readonly string[]>>
  }

  return reads as Readonly<Record<string, readonly string[]>>
}

function readablePlantIds(reads: Readonly<Record<string, readonly string[]>>, activePlantId: string) {
  return Object.keys(reads).filter((plantId) => plantId !== activePlantId)
}

function currentPlantScopes(reads: Readonly<Record<string, readonly string[]>>, activePlantId: string) {
  return accessTokenKind() === 'ingest' ? FULL_ACCESS_SCOPES : reads[activePlantId] ?? []
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

function accessTokenKind(): AccessTokenKind {
  if (dashboardAccess.tokenKind) return dashboardAccess.tokenKind

  return hashParam('token') ? 'ingest' : 'auth'
}

function tokenFromHash() {
  if (typeof window === 'undefined') return ''

  return hashParam('access_token') || hashParam('token')
}

function hashParam(name: string) {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.hash.replace(/^#/, '')).get(name) ?? ''
}

function queryParam(name: string) {
  if (typeof window === 'undefined') return ''

  return new URLSearchParams(window.location.search).get(name) ?? ''
}

function toMonthRow(
  row: MonthRecord,
  tariffRecord: TariffRecord | undefined,
  usdRate: number,
  commercialDate: Date,
  electricHeatingThresholdKwh?: number,
  monthDailyRows?: readonly MonthRow[],
): MonthRow {
  const tariff = toTariff(tariffRecord, electricHeatingSeasonThreshold(row.date, electricHeatingThresholdKwh))
  return toDashboardRow({
    row,
    tariff,
    usdRate,
    date: parseDate(row.date),
    month: displayMonth(row.date),
    commercialDate,
    monthDailyRows,
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
  monthDailyRows,
}: {
  readonly row: MonthRecord
  readonly tariff: Tariff
  readonly usdRate: number
  readonly date: Date
  readonly month: string
  readonly commercialDate: Date
  readonly monthDailyRows?: readonly MonthRow[]
}): MonthRow {
  const utilityMeter = toUtilityMeter(row)
  const snapshot = toSnapshot(row, utilityMeter)
  const isCommercial = monthDailyRows?.some((dailyRow) => dailyRow.isCommercial) ?? date >= commercialDate
  const transitionTotals = commercialTransitionTotals(row.date, commercialDate, monthDailyRows)
  const rowConsumedPrice = consumedPrice(snapshot, tariff)
  const rowPayment = payment(snapshot, tariff, isCommercial)
  const rowSavings = savings(snapshot, tariff, isCommercial)
  const electricityPayment = transitionTotals?.electricityPayment ?? rowPayment
  const electricitySavings = transitionTotals?.electricitySavings ?? rowSavings

  return {
    month,
    date,
    production: row.production,
    exportDay: utilityMeter?.utility.exportDay ?? row.export_day,
    exportNight: utilityMeter?.utility.exportNight ?? row.export_night,
    importDay: snapshot.importDay,
    importNight: snapshot.importNight,
    consumedDay: row.consumption_day,
    consumedNight: row.consumption_night,
    consumedTotal: consumedTotal(snapshot),
    importTotal: importTotal(snapshot),
    balance: balance(snapshot),
    exportPrice: tariff.export,
    exportPriceDay: tariff.export,
    exportPriceNight: tariff.exportNight,
    exportVat: taxValue(tariff.exportTaxes, 'vat'),
    exportMilitary: taxValue(tariff.exportTaxes, 'mil'),
    importPriceDay: tariff.importDay,
    importPriceNight: tariff.importNight,
    electricHeatingThresholdKwh: tariff.electricHeatingThresholdKwh,
    consumedPayment: rowConsumedPrice,
    electricityPayment,
    electricitySavings,
    usdRate,
    roiUsd: usdRate ? electricitySavings / usdRate : 0,
    isCommercial,
    utilityMeter,
  }
}

function commercialTransitionTotals(month: string, commercialDate: Date, monthDailyRows?: readonly MonthRow[]) {
  if (!monthDailyRows?.length) return undefined
  if (month !== dateMonth(commercialDate)) return undefined
  if (parseDate(month) >= commercialDate) return undefined

  return monthDailyRows.reduce(
    (sum, row) => ({
      electricityPayment: sum.electricityPayment + row.electricityPayment,
      electricitySavings: sum.electricitySavings + row.electricitySavings,
    }),
    { electricityPayment: 0, electricitySavings: 0 },
  )
}

function groupDailyRowsByMonth(rows: readonly MonthRow[]) {
  const grouped = new Map<string, MonthRow[]>()
  rows.forEach((row) => {
    const month = dateMonth(row.date)
    grouped.set(month, [...grouped.get(month) ?? [], row])
  })
  return grouped
}

function toSnapshot(row: MonthRecord, utilityMeter?: MonthRow['utilityMeter']): EnergySnapshot {
  return {
    production: row.production,
    exportDay: utilityMeter?.utility.exportDay ?? row.export_day,
    exportNight: utilityMeter?.utility.exportNight ?? row.export_night,
    importDay: utilityMeter?.utility.importDay ?? row.import_day,
    importNight: utilityMeter?.utility.importNight ?? row.import_night,
    consumedDay: row.consumption_day,
    consumedNight: row.consumption_night,
  }
}

function toUtilityMeter(row: MonthRecord): MonthRow['utilityMeter'] {
  const values = [
    row.utility_import_day,
    row.utility_import_night,
    row.utility_export_day,
    row.utility_export_night,
  ]

  if (!values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
    return undefined
  }
  const [
    utilityImportDay,
    utilityImportNight,
    utilityExportDay,
    utilityExportNight,
  ] = values

  return {
    ha: {
      importDay: row.import_day,
      importNight: row.import_night,
      exportDay: row.export_day,
      exportNight: row.export_night,
    },
    utility: {
      importDay: utilityImportDay,
      importNight: utilityImportNight,
      exportDay: utilityExportDay,
      exportNight: utilityExportNight,
    },
  }
}

function toTariff(row: TariffRecord | undefined, electricHeatingThresholdKwh?: number): Tariff {
  return {
    importDay: row?.price_import_day ?? 0,
    importNight: row?.price_import_night ?? 0,
    electricHeatingThresholdKwh,
    export: row?.price_export_day ?? 0,
    exportNight: row?.price_export_night ?? 0,
    exportTaxes: row?.export_taxes ?? [],
  }
}

interface UtilityTargets {
  readonly importDay: number
  readonly importNight: number
  readonly exportDay: number
  readonly exportNight: number
}

function utilityTargetsByMonth(months: readonly MonthRecord[]) {
  return new Map(
    months
      .map((month) => [month.date, utilityTargets(month)] as const)
      .filter((entry): entry is readonly [string, UtilityTargets] => Boolean(entry[1])),
  )
}

function utilityTargets(row: MonthRecord): UtilityTargets | undefined {
  const values = [
    row.utility_import_day,
    row.utility_import_night,
    row.utility_export_day,
    row.utility_export_night,
  ]
  if (!values.every((value): value is number => typeof value === 'number' && Number.isFinite(value))) {
    return undefined
  }
  const [importDay, importNight, exportDay, exportNight] = values
  return { importDay, importNight, exportDay, exportNight }
}

function applyUtilityMeterToDays(days: readonly DayRecord[], targetsByMonth: ReadonlyMap<string, UtilityTargets>): readonly DayRecord[] {
  if (!targetsByMonth.size) return days

  const daysByMonth = new Map<string, readonly DayRecord[]>()
  days.forEach((day) => {
    const month = monthDate(day.date)
    daysByMonth.set(month, [...daysByMonth.get(month) ?? [], day])
  })

  const adjusted = new Map<string, DayRecord>()
  targetsByMonth.forEach((targets, month) => {
    const monthDays = daysByMonth.get(month) ?? []
    if (!monthDays.length) return

    const importDay = distribute(monthDays.map((day) => day.import_day), targets.importDay)
    const importNight = distribute(monthDays.map((day) => day.import_night), targets.importNight)
    const exportDay = distribute(monthDays.map((day) => day.export_day), targets.exportDay)
    const exportNight = distribute(monthDays.map((day) => day.export_night), targets.exportNight)

    monthDays.forEach((day, index) => {
      adjusted.set(day.date, {
        ...day,
        import_day: importDay[index],
        import_night: importNight[index],
        export_day: exportDay[index],
        export_night: exportNight[index],
      })
    })
  })

  return days.map((day) => adjusted.get(day.date) ?? day)
}

function distribute(values: readonly number[], targetTotal: number): readonly number[] {
  if (!values.length) return []

  const currentTotal = values.reduce((sum, value) => sum + value, 0)
  const delta = targetTotal - currentTotal
  const evenDelta = delta / values.length
  const even = values.map((value) => value + evenDelta)

  if (even.every((value) => value >= 0)) {
    return even
  }

  if (currentTotal <= 0) {
    return values.map(() => targetTotal / values.length)
  }

  const factor = targetTotal / currentTotal
  return values.map((value) => value * factor)
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

function dateMonth(date: Date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${date.getFullYear()}-${month}-01`
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
