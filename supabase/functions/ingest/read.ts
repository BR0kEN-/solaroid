import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

async function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const params = new URL(request.url).searchParams
  const plantId = params.get('plant') || token.plant_id

  if (token.plant_id !== plantId && !(plantId in token.reads)) {
    throw new ForbiddenError()
  }

  const documentPath = params.get('document')

  if (documentPath) {
    if (plantId !== token.plant_id || documentPath.split('/')[0] !== plantId) {
      throw new ForbiddenError()
    }

    return {
      documentUrl: await client.getUploadFilePresignedUrl(documentPath),
    }
  }

  if (token.kind === 'auth' && (params.has('plants') || params.has('metadata'))) {
    return {
      plants: await client.getPlants([token.plant_id, ...Object.keys(token.reads)]),
    }
  }

  const granularity = params.get('granularity')
  const includePrivateData = plantId === token.plant_id
  const includeLocation = (token.kind === 'ingest' && includePrivateData) || token.reads[plantId]?.includes('loc') === true

  if (granularity) {
    return client.getPlantDataForGranularity(plantId, granularity, includePrivateData, includeLocation)
  }

  return {
    ...await client.getPlant(plantId, includePrivateData, includeLocation),
    reads: token.reads,
  }
}

export {
  read,
}
