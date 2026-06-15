import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } from './config.ts'
import { fetchPvgisProductionProjection } from './pvgis.ts'
import { hash } from './utils/crypto.ts'
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

  async getAccessToken(bearer: string): Promise<Solaroid.Supabase.Access.Token | undefined> {
    const { data, error } = await this.client
      .from('access_tokens')
      .select(`id,plant_id,reads:access_token_read_scopes(plant_id)`)
      .eq('token_hash', await hash(bearer))
      .limit(1)

    if (error) throw new Error('access token lookup failed', { cause: error })

    const token = data?.[0]

    if (token) {
      return {
        ...token,
        kind: 'ingest',
        reads: token.reads.map((scope) => scope.plant_id),
      }
    }

    const { data: { user }, error: authError } = await this.client.auth.getUser(bearer)

    if (authError || !user?.confirmed_at) return undefined

    const plantIds = await this.#getUserPlantIds(user.id)

    if (plantIds.length === 0) return undefined

    return {
      id: user.id,
      kind: 'auth',
      plant_id: plantIds[0],
      reads: plantIds.slice(1),
    }
  }

  async #getUserPlantIds(userId: string): Promise<readonly Solaroid.Supabase.Plant.Id[]> {
    const { data: access, error: accessError } = await this.client
      .from('user_plant_access')
      .select('plant_id')
      .eq('user_id', userId)
      .order('plant_id', { ascending: true })

    if (accessError) throw new Error('user plant access lookup failed', { cause: accessError })

    return access.map((row) => row.plant_id)
  }

  async getPlantsMetadata(
    plantIds: readonly Solaroid.Supabase.Plant.Id[],
  ): Promise<readonly Solaroid.Supabase.Json[]> {
    if (!plantIds.length) return []

    const { data, error } = await this.client
      .from('plants')
      .select('id,domain')
      .in('id', plantIds)
      .order('id', { ascending: true })

    if (error) throw new Error('plants lookup failed', { cause: error })

    return data
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
      projection: await this.#getPvgisProjection(plant),
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
      table = 'days'
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

  async #getPlantMetadata(plantId: Solaroid.Supabase.Plant.Id): Promise<Solaroid.Supabase.Plant.Record> {
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

  async #getPvgisProjection(plant: Solaroid.Supabase.Plant.Record): Promise<Solaroid.Supabase.Pvgis.Projection | null> {
    const currentHash = await hash(JSON.stringify(plant.metadata))
    const { data: cache, error: cacheError } = await this.client
      .from('plant_pvgis_projections')
      .select('metadata_hash,projection')
      .eq('plant_id', plant.id)
      .maybeSingle()

    if (cacheError) throw new Error('PVGIS projection cache lookup failed', { cause: cacheError })
    if (cache?.metadata_hash === currentHash) return cache.projection

    const projection = await fetchPvgisProductionProjection(plant.metadata)

    if (!projection) return null

    const { error: upsertError } = await this.client
      .from('plant_pvgis_projections')
      .upsert({
        plant_id: plant.id,
        metadata_hash: currentHash,
        projection,
      })

    if (upsertError) throw new Error('PVGIS projection cache upsert failed', { cause: upsertError })

    return projection
  }
}
