import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

async function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const params = new URL(request.url).searchParams
  const plantId = params.get('plant') || token.plant_id

  if (token.plant_id !== plantId && !token.reads.includes(plantId)) {
    throw new ForbiddenError()
  }

  const granularity = params.get('granularity')

  if (granularity) {
    return client.getPlantDataForGranularity(plantId, granularity)
  }

  return {
    ...await client.getPlant(plantId, params.get('year') ?? undefined),
    reads: token.reads,
  }
}

export {
  read,
}
