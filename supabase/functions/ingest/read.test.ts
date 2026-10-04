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
  const includeLocation: boolean[] = []
  const client = plantClient(includePrivateData, includeLocation)

  const data = await read(new Request('https://example.test/ingest?files=false'), token, client)

  if (includePrivateData.length !== 1 || includePrivateData[0] !== true) {
    throw new Error('token plant private data should be included')
  }
  if (includeLocation.length !== 1 || includeLocation[0] !== false) {
    throw new Error('auth plant location should require loc scope')
  }

  if (!('spendings' in data) || JSON.stringify(data.spendings) !== JSON.stringify(spendings)) {
    throw new Error('token plant spendings should preserve the ordered wire shape')
  }
})

Deno.test('read excludes private data for a comparison plant regardless of query', async () => {
  const includePrivateData: boolean[] = []
  const includeLocation: boolean[] = []
  const client = plantClient(includePrivateData, includeLocation)

  const data = await read(new Request('https://example.test/ingest?plant=levched&files=true'), token, client)

  if (includePrivateData.length !== 1 || includePrivateData[0] !== false) {
    throw new Error('comparison plant private data should be excluded')
  }
  if (includeLocation.length !== 1 || includeLocation[0] !== false) {
    throw new Error('comparison plant location should be excluded without loc scope')
  }

  if ('spendings' in data) {
    throw new Error('comparison plant spendings should be omitted')
  }
})

Deno.test('read includes comparison location with loc scope', async () => {
  const includePrivateData: boolean[] = []
  const includeLocation: boolean[] = []
  const client = plantClient(includePrivateData, includeLocation)
  const locToken: Solaroid.Supabase.Access.Token = {
    ...token,
    reads: { levched: ['loc'] },
  }

  await read(new Request('https://example.test/ingest?plant=levched&granularity=2026'), locToken, client)

  if (includePrivateData.length !== 1 || includePrivateData[0] !== false) {
    throw new Error('loc scope should not expose private plant data')
  }
  if (includeLocation.length !== 1 || includeLocation[0] !== true) {
    throw new Error('loc scope should expose comparison location')
  }
})

Deno.test('raw ingest token keeps full location access to its own plant', async () => {
  const includePrivateData: boolean[] = []
  const includeLocation: boolean[] = []
  const client = plantClient(includePrivateData, includeLocation)
  const ingestToken: Solaroid.Supabase.Access.Token = {
    ...token,
    kind: 'ingest',
    reads: {},
  }

  await read(new Request('https://example.test/ingest'), ingestToken, client)

  if (includeLocation.length !== 1 || includeLocation[0] !== true) {
    throw new Error('raw own-plant access should include location')
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

Deno.test('read lists assigned plant ids for portal auth', async () => {
  const requestedPlantIds: string[][] = []
  const client = {
    getPlants: (plantIds: readonly string[]) => {
      requestedPlantIds.push([...plantIds])
      return Promise.resolve(plantIds.map((id) => ({ id })))
    },
  } as unknown as SupabaseClient

  const data = await read(new Request('https://example.test/ingest?plants=1'), token, client)

  if (JSON.stringify(requestedPlantIds) !== JSON.stringify([['bondas', 'levched']])) {
    throw new Error('portal plant list should contain assigned plant ids')
  }
  if (!('plants' in data) || JSON.stringify(data.plants) !== JSON.stringify([{ id: 'bondas' }, { id: 'levched' }])) {
    throw new Error('portal plant list should expose ids only')
  }
})

const spendings: readonly Solaroid.Supabase.Plant.Spending.Record[] = [
  {
    id: 0,
    plant_id: 'bondas',
    date: '2025-06-28',
    type: 'initial',
    amount_usd: 10_000,
    created_at: '2025-06-28 00:00:00.000+00',
    updated_at: '2025-06-28 00:00:00.000+00',
  },
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
    type: 'improvement',
    amount_usd: 500,
    created_at: '2026-08-21 00:00:00.000+00',
    updated_at: '2026-08-21 00:00:00.000+00',
  },
]

function plantClient(includePrivateData: boolean[], includeLocation: boolean[]) {
  return {
    getPlant: (plantId: string, include = true, location = include) => {
      includePrivateData.push(include)
      includeLocation.push(location)
      return Promise.resolve(plantData(plantId, include))
    },
    getPlantDataForGranularity: (plantId: string, _granularity: string, include = false, location = include) => {
      includePrivateData.push(include)
      includeLocation.push(location)
      return Promise.resolve(plantData(plantId, include))
    },
  } as unknown as SupabaseClient
}

function plantData(id: string, includePrivateData: boolean) {
  return {
    plant: {
      id,
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
