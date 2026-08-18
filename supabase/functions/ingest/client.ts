import { createClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, UPLOAD_MAX_SIZE, UPLOAD_TYPES } from './config.ts'
import { Pvgis } from './pvgis.ts'
import { hash } from './utils/crypto.ts'
import { dateUtil } from './utils/date.ts'

function toReads(
  input: readonly { readonly plant_id: Solaroid.Supabase.Plant.Id, scopes: Solaroid.Supabase.Access.Scope[] }[],
): Solaroid.Supabase.Access.Reads {
  return input.reduce(
    (accumulator, plant) => {
      accumulator[plant.plant_id] = plant.scopes || []

      return accumulator
    },
    {} as Solaroid.Supabase.Access.Reads,
  )
}

export class SupabaseClient implements Solaroid.Supabase.Dam.Storage, Solaroid.Supabase.Email.Storage {
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
    const { data: token, error } = await this.client
      .from('access_tokens')
      .select(`id,plant_id,reads:access_token_read_scopes(plant_id,scopes)`)
      .eq('token_hash', await hash(bearer))
      .maybeSingle()

    if (error) throw new Error('access token lookup failed', { cause: error })

    if (token) {
      return {
        ...token,
        kind: 'ingest',
        reads: toReads(token.reads),
      }
    }

    const { data: { user }, error: authError } = await this.client.auth.getUser(bearer)

    if (authError || !user?.confirmed_at) return undefined

    const plants = await this.#getUserPlants(user.id)

    if (plants.length === 0) return undefined

    return {
      id: user.id,
      kind: 'auth',
      plant_id: plants[0].plant_id,
      reads: toReads(plants),
    }
  }

  async #getUserPlants(userId: string) {
    const { data: access, error: accessError } = await this.client
      .from('user_plant_access')
      .select('plant_id,scopes')
      .eq('user_id', userId)
      .order('plant_id', { ascending: true })

    if (accessError) throw new Error('user plant access lookup failed', { cause: accessError })

    return access
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

  async updatePlantRow(
    table: string,
    row: Solaroid.Supabase.Json,
  ): Promise<void> {
    const { plant_id: plantId, date, ...values } = row
    const { error } = await this.client
      .from(table)
      .update(values)
      .eq('plant_id', plantId)
      .eq('date', date)

    if (error) throw new Error(`update failed on ${table}`, { cause: error })
  }

  async uploadFile(document: Solaroid.Supabase.Email.Document): Promise<void> {
    const { month, pdf, plantId, report, signature, type } = document

    if (
      pdf.byteLength <= 0 ||
      pdf.byteLength > UPLOAD_MAX_SIZE ||
      (signature && (signature.content.byteLength <= 0 || signature.content.byteLength > UPLOAD_MAX_SIZE))
    ) {
      throw new Error(`Document must be between 1 and ${UPLOAD_MAX_SIZE} bytes`)
    }

    if (!dateUtil.granularity.is.month(month)) {
      throw new Error('Document month must use YYYY-MM format')
    }

    if (!UPLOAD_TYPES.includes(type)) {
      throw new Error(`Upload of "${type}" documents is forbidden`)
    }

    const { data: monthRow, error: monthError } = await this.client
      .from('months')
      .select('date')
      .eq('plant_id', plantId)
      .eq('date', `${month}-01`)
      .maybeSingle()

    if (monthError) throw new Error('Month lookup failed', { cause: monthError })
    if (!monthRow) throw new Error(`${month} is not available for this plant`)

    const uploads: [ArrayBuffer, string, { suffix?: string, metadata?: object }][] = [
      [pdf, 'application/pdf', { metadata: { report } }],
    ]

    if (signature) {
      uploads.push([signature.content, signature.contentType, { suffix: '-signature' }])
    }

    await Promise.all(
      uploads.map(async ([content, contentType, options]) => {
        const name = `${plantId}/${type}/${month}${options?.suffix || ''}`
        const { error } = await this.client.storage
          .from('month-docs')
          .upload(
            name,
            new Uint8Array(content),
            {
              contentType,
              upsert: true,
              metadata: {
                month,
                plantId,
                ...(options?.metadata || {}),
              },
            },
          )

        if (error) throw new Error(`${name} upload failed`, { cause: error })
      })
    )
  }

  async getUploadedFiles(
    plantId: Solaroid.Supabase.Plant.Id,
    month: Solaroid.Supabase.Date.Ym,
  ): Promise<readonly Solaroid.Supabase.Upload.File[]> {
    const { data, error } = await this.client.rpc('month_docs', { plant_id: plantId, month })

    if (error) throw new Error('Files lookup failed', { cause: error })

    const files: Solaroid.Supabase.Upload.File[] = []

    for (const { user_metadata, ...file } of data || []) {
      if (file.name.endsWith('-signature')) continue

      const [, type] = file.name.split('/')
      // It's known.
      delete user_metadata.plantId

      files.push({
        type,
        path: file.name,
        size: Number(file.metadata.size),
        mime: String(file.metadata.mimetype),
        metadata: user_metadata,
      })
    }

    return files
  }

  async getUploadFilePresignedUrl(path: string): Promise<string> {
    const { data, error } = await this.client
      .storage
      .from('month-docs')
      .createSignedUrl(path, 60)

    if (error) throw new Error('Document URL creation failed', { cause: error })

    return data.signedUrl
  }

  async getLatestDamPriceUpdatedAt(): Promise<string | undefined> {
    const { data, error } = await this.client
      .from('dam_prices')
      .select('updated_at')
      .order('updated_at', { ascending: false })
      .limit(1)

    if (error) throw new Error('DAM price freshness lookup failed', { cause: error })

    return data[0]?.updated_at
  }

  async upsertDamPrices(rows: readonly Solaroid.Supabase.Dam.Record[]): Promise<void> {
    if (!rows.length) return

    const { error } = await this.client
      .from('dam_prices')
      .upsert(rows, { onConflict: 'date' })

    if (error) throw new Error('DAM price upsert failed', { cause: error })
  }

  async getPlant(plantId: Solaroid.Supabase.Plant.Id, includeFiles = true) {
    const plant = await this.#getPlantMetadata(plantId)
    const [days, months, tariffs] = await Promise.all(
      ['days', 'months', 'month_tariffs'].map((table) => this.#getPlantRows(plantId, table)),
    )

    return {
      plant,
      days,
      tariffs,
      projection: await this.#getPvgisProjection(plant),
      months: includeFiles ? await Promise.all(
        months.map(async (row) => {
          // @ts-expect-error TS18046
          const [y, m] = row.date.split('-')

          return {
            ...row,
            files: await this.getUploadedFiles(plantId, `${y}-${m}`),
          }
        }),
      ) : months,
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
    const currentHash = await hash(JSON.stringify({ m: plant.metadata, q: Pvgis.BaseQuery }))
    const { data: cache, error: cacheError } = await this.client
      .from('plant_pvgis_projections')
      .select('metadata_hash,projection')
      .eq('plant_id', plant.id)
      .maybeSingle()

    if (cacheError) throw new Error('PVGIS projection cache lookup failed', { cause: cacheError })
    if (cache?.metadata_hash === currentHash) return cache.projection

    const projection = await Pvgis.getProjection(plant.metadata)

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
