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

    namespace Access {
      type Kind = 'ingest' | 'auth'

      interface Token {
        readonly id: string
        readonly kind: Kind
        readonly plant_id: Plant.Id
        readonly reads: readonly Plant.Id[]
      }
    }

    namespace Http {
      type Method = string
      type Handler = (request: Request, token: Access.Token, client: SupabaseClient) => Promise<Json>
    }
  }
}

export {}
