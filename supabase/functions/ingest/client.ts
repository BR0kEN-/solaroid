import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts'
import { dateUtil } from './utils/date.ts'

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
      .select(`id,plant_id,reads:access_token_read_scopes(plant_id)`)
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
    const plant = await this.#getPlantMetadata(plantId)
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

  async getPlantDataForGranularity(
    plantId: Solaroid.Supabase.Plant.Id,
    granularity: Solaroid.Supabase.Date.Granularity,
  ) {
    let table: string
    let range: Solaroid.Supabase.Date.Range
    let month: Solaroid.Supabase.Date.Range

    if (dateUtil.granularity.is.day(granularity)) {
      table = 'days'
      range = { from: granularity }
      month = { from: dateUtil.getMonthStart(granularity) }
    } else if (dateUtil.granularity.is.month(granularity)) {
      table = 'months'
      range = { from: `${granularity}-01`, to: `${granularity}-31` }
      month = { from: range.from }
    } else if (dateUtil.granularity.is.year(granularity)) {
      table = 'months'
      range = { from: `${granularity}-01-01`, to: `${granularity}-12-31` }
      month = range
    } else {
      throw new Error('Invalid granularity.')
    }

    return {
      plant: await this.#getPlantMetadata(plantId),
      records: await this.#getPlantRows(plantId, table, range),
      tariffs: await this.#getPlantRows(plantId, 'month_tariffs', month),
    }
  }

  async #getPlantMetadata(plantId: Solaroid.Supabase.Plant.Id) {
    const { data, error } = await this.client
      .from('plants')
      .select('*')
      .eq('id', plantId)
      .order('id', { ascending: true })
      .single()

    if (error) throw new Error('plant lookup failed', { cause: error })

    return data
  }

  async #getPlantRows(
    plantId: Solaroid.Supabase.Plant.Id,
    table: string,
    range?: Solaroid.Supabase.Date.Range,
  ): Promise<readonly Solaroid.Supabase.Json[]> {
    let query = this.client
      .from(table)
      .select('*')
      .eq('plant_id', plantId)

    if (range) {
      query = query
        .gte('date', range.from)
        .lte('date', range.to ?? range.from)
    }

    const { data, error } = await query
      .order('plant_id', { ascending: true })
      .order('date', { ascending: true })

    if (error) throw new Error(`${table} lookup failed`, { cause: error })

    return data
  }
}
