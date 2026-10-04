import type { SupabaseClient } from './client.ts'
import type { UPLOAD_TYPES } from './config.ts'

declare global {
  namespace Solaroid.Supabase {
    type Json = Record<string, unknown>

    namespace Date {
      // 4 digits, e.g. `2026`.
      type Y = string
      // 2 digits, e.g. `06`.
      type M = string
      // 2 digits, e.g. `30`.
      type D = string
      // The `Y-m` format, e.g. `2026-06`.
      type Ym = `${Y}-${M}`
      // The `Y-m-d` format, e.g. `2026-06-30`.
      type Ymd = `${Ym}-${D}`
      type Iso8601 = `${Ymd} ${number}:${number}:${number}.${number}+${number}`
      type Granularity = Y | Ym | Ymd

      interface Range {
        readonly from: Ymd
        // Defaults to `from`.
        readonly to?: Ymd
      }
    }

    namespace Plant {
      type Id = string

      namespace Spending {
        type Type = 'initial' | 'damage_replacement' | 'improvement'

        interface Record {
          readonly id: number
          readonly plant_id: Id
          readonly date: Date.Ymd
          readonly type: Type
          readonly amount_usd: number
          readonly created_at: Date.Iso8601
          readonly updated_at: Date.Iso8601
        }
      }

      namespace Pv {
        type ChangeType = 'commissioning' | 'improvement' | 'damage_replacement'

        interface Field {
          readonly id?: string
          readonly modules?: number
          readonly azimuth: number
          readonly power: number
          readonly slope: number
          readonly elevation: number
          readonly lat: number
          readonly lng: number
          readonly loss: number
          readonly mounting: string
        }

        interface HistoricalField extends Field {
          readonly id: string
          readonly modules: number
        }

        interface IncreaseFieldOperation {
          readonly kind: 'increase_field'
          readonly field_id: string
          readonly modules_added: number
          readonly power_added_w: number
        }

        interface AddFieldOperation {
          readonly kind: 'add_field'
          readonly field: HistoricalField
        }

        interface DecreaseFieldOperation {
          readonly kind: 'decrease_field'
          readonly field_id: string
          readonly modules_removed: number
          readonly power_removed_w: number
        }

        interface RemoveFieldOperation {
          readonly kind: 'remove_field'
          readonly field: HistoricalField
        }

        type ChangeOperation =
          | IncreaseFieldOperation
          | AddFieldOperation
          | DecreaseFieldOperation
          | RemoveFieldOperation

        interface ChangeRecord {
          readonly id: number
          readonly plant_id: Id
          readonly date: Date.Ymd
          readonly type: ChangeType
          readonly spending_id: number | null
          readonly operations: readonly ChangeOperation[]
        }
      }

      interface Record {
        readonly id: Id
        readonly launch_date: Date.Ymd
        readonly commercial_date: Date.Ymd
        readonly electric_heating_import_threshold_kwh?: number
        readonly capacity_kwp?: number
        readonly modules?: number
        readonly created_at: Date.Iso8601
        readonly updated_at: Date.Iso8601
      }
    }

    namespace Pvgis {
      interface Row {
        readonly month: number
        readonly E_d?: number
        readonly E_m?: number
      }

      interface Response {
        readonly outputs?: {
          readonly monthly?: {
            readonly fixed?: readonly Row[]
          }
        }
      }

      interface Projection {
        readonly monthlyKwh: readonly number[]
        readonly dailyKwh: readonly number[]
        readonly periods?: readonly ProjectionPeriod[]
      }

      interface ProjectionPeriod {
        readonly effectiveDate: Date.Ymd
        readonly spendingId?: number
        readonly modules: number
        readonly capacityKwp: number
        readonly monthlyKwh: readonly number[]
        readonly dailyKwh: readonly number[]
      }
    }

    // Day-ahead market.
    namespace Dam {
      interface Record {
        readonly date: Date.Ymd
        readonly hour1: number
        readonly hour2: number
        readonly hour3: number
        readonly hour4: number
        readonly hour5: number
        readonly hour6: number
        readonly hour7: number
        readonly hour8: number
        readonly hour9: number
        readonly hour10: number
        readonly hour11: number
        readonly hour12: number
        readonly hour13: number
        readonly hour14: number
        readonly hour15: number
        readonly hour16: number
        readonly hour17: number
        readonly hour18: number
        readonly hour19: number
        readonly hour20: number
        readonly hour21: number
        readonly hour22: number
        readonly hour23: number
        readonly hour24: number
      }

      interface Storage {
        getLatestDamPriceUpdatedAt(): Promise<string | undefined>
        upsertDamPrices(rows: readonly Record[]): Promise<void>
      }
    }

    namespace Access {
      type Kind = 'ingest' | 'auth'
      type Scope = 'loc'
      type Reads = Record<Plant.Id, readonly Scope[]>

      interface Token {
        readonly id: string
        readonly kind: Kind
        readonly plant_id: Plant.Id
        readonly reads: Reads
      }
    }

    namespace Http {
      type Method = string
      type Handler = (request: Request, token: Access.Token, client: SupabaseClient) => Promise<Json>
    }

    namespace Document {
      interface Pdf {
        readonly filename: string
        readonly content: ArrayBuffer
      }

      interface Signature {
        readonly content: ArrayBuffer
        readonly contentType: string
      }

      interface GridEnergy {
        readonly importKwh: number
        readonly exportKwh: number
      }

      interface PayableEnergy {
        readonly consumerKwh: number
        readonly supplierKwh: number
      }

      interface Energy {
        readonly grid: GridEnergy
        readonly payable: PayableEnergy
      }

      interface PurchaseRow {
        readonly kwh: number
        readonly priceKopPerKwh: number
        readonly amountUah: number
      }

      interface Purchase {
        readonly greenTariff: PurchaseRow
        readonly weightedPrice: PurchaseRow
      }

      interface Taxes {
        readonly personalIncomeUah: number
        readonly militaryLevyUah: number
      }

      interface Payment {
        readonly grossUah: number
        readonly taxes: Taxes
        readonly netUah: number
      }

      interface GreenTariffReport {
        readonly account: string
        readonly eic: string
        readonly actDate: Date.Ymd
        readonly energy: Energy
        readonly purchase: Purchase
        readonly payment: Payment
      }
    }

    namespace Email {
      type Handler = (request: Request, bearer: string, client: SupabaseClient) => Promise<Json>

      interface AnalysisInput {
        readonly subject: string
        readonly text: string
        readonly pdfs: readonly Document.Pdf[]
      }

      interface Analysis {
        readonly attachmentIndex?: number
        readonly document?: {
          readonly type: Upload.Type
          readonly month: Date.Ym
          readonly report: Document.GreenTariffReport
        }
      }

      type Analyzer = (input: AnalysisInput) => Promise<Analysis>

      interface Document {
        readonly plantId: Plant.Id
        readonly type: Upload.Type
        readonly month: Date.Ym
        readonly report: Solaroid.Supabase.Document.GreenTariffReport
        readonly pdf: ArrayBuffer
        readonly signature?: Solaroid.Supabase.Document.Signature
      }

      interface Storage {
        uploadFile(document: Document): Promise<void>

        getUploadedFiles(
          plantId: Plant.Id,
          month: Date.Ym,
        ): Promise<readonly Upload.File[]>

        getUploadFilePresignedUrl(path: string): Promise<string>
      }
    }

    namespace Upload {
      type Type = typeof UPLOAD_TYPES[number]

      interface File<T extends object = object> {
        readonly type: Type
        readonly path: string
        readonly size: number
        readonly mime: string
        readonly metadata: T
      }
    }
  }
}

export {}
