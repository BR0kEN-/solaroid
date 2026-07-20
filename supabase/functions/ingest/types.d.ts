import type { SupabaseClient } from './client.ts'

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

      namespace Pv {
        interface Field {
          readonly azimuth: number
          readonly power: number
          readonly slope: number
          readonly elevation: number
          readonly lat: number
          readonly lng: number
          readonly loss: number
          readonly mounting: string
        }
      }

      interface Metadata {
        readonly pvs?: readonly Pv.Field[]
      }

      interface Record {
        readonly id: Id
        readonly domain: string
        readonly metadata: Metadata
        // In USD.
        readonly investment_usd: number
        readonly launch_date: Date.Ymd
        readonly commercial_date: Date.Ymd
        readonly electric_heating_import_threshold_kwh?: number
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
  }
}

export {}
