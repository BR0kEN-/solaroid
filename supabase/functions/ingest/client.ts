import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts'

export class SupabaseClient {
  protected readonly client

  constructor() {
    this.client = createClient(
      SUPABASE_URL,
      SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
      },
    )
  }

  async upsertRow(
    table: string,
    row: Solaroid.Supabase.Json,
    onConflict: string,
    ignoreDuplicates = false,
  ): Promise<void> {
    const { error } = await this.client
      .from(table)
      .upsert(row, { onConflict, ignoreDuplicates })

    if (error) throw new Error(`upsert failed on ${table}`, { cause: error })
  }
}
