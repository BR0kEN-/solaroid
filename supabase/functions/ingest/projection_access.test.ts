import { isPvgisProjectionCacheHit, plantForAccess, projectionForAccess, pvgisProjectionCacheInput } from './client.ts'

const plant: Solaroid.Supabase.Plant.Record = {
  id: 'test-plant',
  domain: 'example.test',
  metadata: {
    pvs: [{
      id: 'south',
      modules: 32,
      azimuth: 180,
      power: 13_120,
      slope: 30,
      elevation: 100,
      lat: 1,
      lng: 2,
      loss: 14,
      mounting: 'building',
    }],
  },
  investment_usd: 10_000,
  launch_date: '2025-06-28',
  commercial_date: '2026-01-01',
  created_at: '2025-06-28 00:00:00.000+00',
  updated_at: '2026-10-03 00:00:00.000+00',
}

const projection: Solaroid.Supabase.Pvgis.Projection = {
  monthlyKwh: Array.from({ length: 12 }, () => 3_200),
  dailyKwh: Array.from({ length: 12 }, () => 100),
  periods: [{
    effectiveDate: '2025-06-28',
    spendingId: 7,
    modules: 32,
    capacityKwp: 13.12,
    monthlyKwh: Array.from({ length: 12 }, () => 3_200),
    dailyKwh: Array.from({ length: 12 }, () => 100),
  }],
}

Deno.test('own plant projection keeps spending linkage and PV metadata', () => {
  const visibleProjection = projectionForAccess(projection, true)
  const visiblePlant = plantForAccess(plant, projection, true)

  if (visibleProjection?.periods?.[0].spendingId !== 7) throw new Error('spending linkage should remain visible')
  if (!visiblePlant.metadata.pvs?.[0].lat) throw new Error('own PV metadata should remain visible')
})

Deno.test('comparison projection exposes capacity but strips spending and field configuration', () => {
  const visibleProjection = projectionForAccess(projection, false)
  const visiblePlant = plantForAccess(plant, projection, false)

  if (visibleProjection?.periods?.[0].spendingId !== undefined) throw new Error('spending linkage should be private')
  if (visiblePlant.metadata.pvs !== undefined) throw new Error('PV field configuration should be private')
  if (visiblePlant.capacity_kwp !== 13.12 || visiblePlant.modules !== 32) throw new Error('derived capacity should remain visible')
})

Deno.test('PVGIS cache input is order-stable and changes with launch or operations', () => {
  const first = change(1, '2025-08-10', 10)
  const second = change(2, '2026-03-15', 13)
  const input = pvgisProjectionCacheInput(plant, [second, first])

  if (input !== pvgisProjectionCacheInput(plant, [first, second])) throw new Error('cache input should use ordered changes')
  if (input === pvgisProjectionCacheInput({ ...plant, launch_date: '2025-06-29' }, [first, second])) {
    throw new Error('launch date should invalidate the cache')
  }
  if (input === pvgisProjectionCacheInput(plant, [change(1, '2025-08-10', 11), second])) {
    throw new Error('operation changes should invalidate the cache')
  }
  if (!isPvgisProjectionCacheHit('same', 'same') || isPvgisProjectionCacheHit('old', 'new')) {
    throw new Error('cache hit should require an exact hash match')
  }
})

function change(id: number, date: Solaroid.Supabase.Date.Ymd, modulesAdded: number): Solaroid.Supabase.Plant.Pv.ChangeRecord {
  return {
    spending_id: id,
    operations: [{ kind: 'increase_field', field_id: 'south', modules_added: modulesAdded, power_added_w: modulesAdded * 410 }],
    spending: { id, date, type: 'improvement' },
  }
}
