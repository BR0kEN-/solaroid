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

  async getAccessToken(tokenHash: string): Promise<Solaroid.Supabase.Access.Token | undefined> {
    const { data, error } = await this.client
      .from('access_tokens')
      .select(`id,plant_id,reads!access_token_read_scopes(plant_id)`)
      .eq('token_hash', tokenHash)
      .limit(1)

    if (error) throw new Error('access token lookup failed', { cause: error })

    const token = data?.[0]

    if (!token) return undefined

    return {
      ...token,
      reads: token.reads.map((scope) => scope.plant_id),
    }
  }

  async upsertPlantRow(
    table: string,
    row: Solaroid.Supabase.Json,
    ignoreDuplicates = false,
  ): Promise<void> {
    const { error } = await this.client
      .from(table)
      .upsert(row, { onConflict: 'plant_id,date', ignoreDuplicates })

    if (error) throw new Error(`upsert failed on ${table}`, { cause: error })
  }

  async getPlant(plantId: Solaroid.Supabase.Plant.Id): Promise<Solaroid.Supabase.Json> {
    const { data: plant, error } = await this.client
      .from('plants')
      .select('*')
      .eq('id', plantId)
      .order('id', { ascending: true })
      .single()

    if (error) throw new Error('plants lookup failed', { cause: error })

    const [days, months, tariffs] = await Promise.all(
      ['days', 'months', 'month_tariffs'].map((table) => this.#getPlantRows(plantId, table)),
    )

    return {
      plant,
      days,
      months,
      tariffs,
    }
  }

  async #getPlantRows(plantId: Solaroid.Supabase.Plant.Id, table: string): Promise<readonly Solaroid.Supabase.Json[]> {
    const { data, error } = await this.client
      .from(table)
      .select('*')
      .eq('plant_id', plantId)
      .order('plant_id', { ascending: true })
      .order('date', { ascending: true })

    if (error) throw new Error(`${table} lookup failed`, { cause: error })

    return data
  }
}
