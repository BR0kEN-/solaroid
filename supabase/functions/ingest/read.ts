import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

function applyAccess<T extends { readonly plant: Solaroid.Supabase.Plant.Record }>(
  token: Solaroid.Supabase.Access.Token,
  data: T,
): T {
  const ownPlant = token.kind === 'ingest' && data.plant.id === token.plant_id

  if (!ownPlant && !token.reads[data.plant.id]?.includes('loc')) {
    for (const pv of data.plant.metadata?.pvs || []) {
      // @ts-expect-error no permission to access location, suppressing.
      pv.lat = pv.lng = 0
    }
  }

  return data
}

async function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const params = new URL(request.url).searchParams
  const plantId = params.get('plant') || token.plant_id

  if (token.plant_id !== plantId && !(plantId in token.reads)) {
    throw new ForbiddenError()
  }

  if (token.kind === 'auth' && params.has('metadata')) {
    return {
      plants: await client.getPlantsMetadata([token.plant_id, ...Object.keys(token.reads)]),
    }
  }

  const granularity = params.get('granularity')

  if (granularity) {
    return applyAccess(token, await client.getPlantDataForGranularity(plantId, granularity))
  }

  return {
    ...applyAccess(token, await client.getPlant(plantId)),
    reads: token.reads,
  }
}

export {
  read,
}
