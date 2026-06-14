import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

async function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const params = new URL(request.url).searchParams
  const plantId = params.get('plant') || token.plant_id

  if (token.plant_id !== plantId && !token.reads.includes(plantId)) {
    throw new ForbiddenError()
  }

  if (token.kind === 'auth' && params.has('metadata')) {
    return {
      plants: await client.getPlantsMetadata([token.plant_id, ...token.reads]),
    }
  }

  const granularity = params.get('granularity')

  if (granularity) {
    return client.getPlantDataForGranularity(plantId, granularity)
  }

  return {
    ...await client.getPlant(plantId),
    reads: token.reads,
  }
}

export {
  read,
}
