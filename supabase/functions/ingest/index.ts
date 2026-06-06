import { SupabaseClient } from './client.ts'
import { Input } from './schema.ts'
import { serve } from './server.ts'

serve({
  POST: async (body) => {
    const client = new SupabaseClient()
    const rows = Input.parse(body)

    await client.upsertRow('days', rows.day, 'plant_id,date')
    await client.upsertRow('months', rows.month, 'plant_id,date')
    // Storing tariff only once, no updates allowed. That's
    // intentional because tariffs don't change mid-month.
    await client.upsertRow('month_tariffs', rows.tariff, 'plant_id,date', true)

    return {
      date: rows.day.date,
    }
  },
})
