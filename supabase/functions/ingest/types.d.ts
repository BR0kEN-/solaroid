import type { SupabaseClient } from './client.ts'

declare global {
  namespace Solaroid.Supabase {
    type Json = Record<string, unknown>

    namespace Plant {
      type Id = string
    }

    namespace Access {
      interface Token {
        readonly id: string
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
