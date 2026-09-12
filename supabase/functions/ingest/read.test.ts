import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'
import { read } from './read.ts'

const token: Solaroid.Supabase.Access.Token = {
  id: 'token',
  kind: 'auth',
  plant_id: 'bondas',
  reads: { levched: [] },
}

Deno.test('read includes private data for the token plant regardless of query', async () => {
  const includePrivateData: boolean[] = []
  const client = plantClient(includePrivateData)

  const data = await read(new Request('https://example.test/ingest?files=false'), token, client)

  if (includePrivateData.length !== 1 || includePrivateData[0] !== true) {
    throw new Error('token plant private data should be included')
  }

  if (!('spendings' in data) || JSON.stringify(data.spendings) !== JSON.stringify(spendings)) {
    throw new Error('token plant spendings should preserve the ordered wire shape')
  }
})

Deno.test('read excludes private data for a comparison plant regardless of query', async () => {
  const includePrivateData: boolean[] = []
  const client = plantClient(includePrivateData)

  const data = await read(new Request('https://example.test/ingest?plant=levched&files=true'), token, client)

  if (includePrivateData.length !== 1 || includePrivateData[0] !== false) {
    throw new Error('comparison plant private data should be excluded')
  }

  if ('spendings' in data) {
    throw new Error('comparison plant spendings should be omitted')
  }
})

Deno.test('read forbids document URLs for comparison plants', async () => {
  let requested = false
  const client = {
    getUploadFilePresignedUrl: () => {
      requested = true
      return Promise.resolve('https://storage.example.test/document')
    },
  } as unknown as SupabaseClient

  try {
    await read(
      new Request('https://example.test/ingest?plant=levched&document=levched/green-tariff-receipt/2026-05'),
      token,
      client,
    )
    throw new Error('comparison document should be forbidden')
  } catch (error) {
    if (!(error instanceof ForbiddenError)) throw error
  }

  if (requested) {
    throw new Error('comparison document URL should not be requested')
  }
})

const spendings: readonly Solaroid.Supabase.Plant.Spending.Record[] = [
  {
    id: 1,
    plant_id: 'bondas',
    date: '2026-08-20',
    type: 'damage_replacement',
    amount_usd: 2_000,
    created_at: '2026-08-20 00:00:00.000+00',
    updated_at: '2026-08-20 00:00:00.000+00',
  },
  {
    id: 2,
    plant_id: 'bondas',
    date: '2026-08-20',
    type: 'damage_replacement',
    amount_usd: 500,
    created_at: '2026-08-21 00:00:00.000+00',
    updated_at: '2026-08-21 00:00:00.000+00',
  },
]

function plantClient(includePrivateData: boolean[]) {
  return {
    getPlant: (plantId: string, include = true) => {
      includePrivateData.push(include)
      return Promise.resolve(plantData(plantId, include))
    },
  } as unknown as SupabaseClient
}

function plantData(id: string, includePrivateData: boolean) {
  return {
    plant: {
      id,
      domain: 'example.test',
      metadata: {},
      investment_usd: 0,
      launch_date: '2026-01-01',
      commercial_date: '2026-01-01',
      created_at: '2026-01-01 00:00:00.000+00',
      updated_at: '2026-01-01 00:00:00.000+00',
    },
    days: [],
    months: [],
    tariffs: [],
    projection: null,
    ...(includePrivateData ? { spendings } : {}),
  }
}
