import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'
import { read } from './read.ts'

const token: Solaroid.Supabase.Access.Token = {
  id: 'token',
  kind: 'auth',
  plant_id: 'bondas',
  reads: { levched: [] },
}

Deno.test('read includes files for the token plant regardless of query', async () => {
  const includeFiles: boolean[] = []
  const client = plantClient(includeFiles)

  await read(new Request('https://example.test/ingest?files=false'), token, client)

  if (includeFiles.length !== 1 || includeFiles[0] !== true) {
    throw new Error('token plant files should be included')
  }
})

Deno.test('read excludes files for a comparison plant regardless of query', async () => {
  const includeFiles: boolean[] = []
  const client = plantClient(includeFiles)

  await read(new Request('https://example.test/ingest?plant=levched&files=true'), token, client)

  if (includeFiles.length !== 1 || includeFiles[0] !== false) {
    throw new Error('comparison plant files should be excluded')
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

function plantClient(includeFiles: boolean[]) {
  return {
    getPlant: (plantId: string, include = true) => {
      includeFiles.push(include)
      return Promise.resolve(plantData(plantId))
    },
  } as unknown as SupabaseClient
}

function plantData(id: string) {
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
  }
}
