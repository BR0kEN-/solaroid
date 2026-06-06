import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const plantId = new URL(request.url).searchParams.get('plant')

  if (!plantId) {
    throw new Error('The plant ID must be provided.')
  }

  if (token.plant_id !== plantId && !token.reads.includes(plantId)) {
    throw new ForbiddenError()
  }

  return client.getPlant(plantId)
}

export {
  read,
}
