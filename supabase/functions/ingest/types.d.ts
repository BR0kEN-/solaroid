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
      type Granularity = Y | Ym | Ymd

      interface Range {
        readonly from: Ymd
        // Defaults to `from`.
        readonly to?: Ymd
      }
    }

    namespace Plant {
      type Id = string
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
