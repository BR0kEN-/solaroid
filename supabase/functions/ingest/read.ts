import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'

async function read(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  const plantId = new URL(request.url).searchParams.get('plant') || token.plant_id

  if (token.plant_id !== plantId && !token.reads.includes(plantId)) {
    throw new ForbiddenError()
  }

  return {
    ...await client.getPlant(plantId),
    reads: token.reads,
  }
}

export {
  read,
}
