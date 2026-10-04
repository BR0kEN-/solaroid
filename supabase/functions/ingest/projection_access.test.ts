import { isPvgisProjectionCacheHit, plantForAccess, projectionForAccess, pvgisProjectionCacheInput } from './client.ts'

const plant: Solaroid.Supabase.Plant.Record = {
  id: 'test-plant',
  launch_date: '2025-06-28',
  commercial_date: '2026-01-01',
  created_at: '2025-06-28 00:00:00.000+00',
  updated_at: '2026-10-03 00:00:00.000+00',
}

const projection: Solaroid.Supabase.Pvgis.Projection = {
  monthlyKwh: Array.from({ length: 12 }, () => 3_200),
  dailyKwh: Array.from({ length: 12 }, () => 100),
  periods: [
    {
      effectiveDate: '2025-06-28',
      modules: 9,
      capacityKwp: 3.69,
      monthlyKwh: Array.from({ length: 12 }, () => 900),
      dailyKwh: Array.from({ length: 12 }, () => 30),
    },
    {
      effectiveDate: '2025-08-10',
      spendingId: 7,
      modules: 32,
      capacityKwp: 13.12,
      monthlyKwh: Array.from({ length: 12 }, () => 3_200),
      dailyKwh: Array.from({ length: 12 }, () => 100),
    },
  ],
}

Deno.test('own plant projection keeps spending linkage and derived capacity', () => {
  const visibleProjection = projectionForAccess(projection, true)
  const visiblePlant = plantForAccess(plant, projection)

  if (visibleProjection?.periods?.[1].spendingId !== 7) throw new Error('spending linkage should remain visible')
  if (visiblePlant.capacity_kwp !== 13.12 || visiblePlant.modules !== 32) {
    throw new Error('own plant should receive current capacity from projection events')
  }
})

Deno.test('comparison projection exposes capacity but strips spending linkage', () => {
  const visibleProjection = projectionForAccess(projection, false)
  const visiblePlant = plantForAccess(plant, projection)

  if (visibleProjection?.periods?.some((period) => period.spendingId !== undefined)) {
    throw new Error('spending linkage should be private')
  }
  if (visiblePlant.capacity_kwp !== 13.12 || visiblePlant.modules !== 32) throw new Error('derived capacity should remain visible')
})

Deno.test('PVGIS cache input is order-stable and changes with launch or operations', () => {
  const first = change(1, '2025-08-10', 10)
  const second = change(2, '2026-03-15', 13)
  const input = pvgisProjectionCacheInput(plant, [second, first])

  if (!input.includes('"v":4')) throw new Error('cache input should include projection algorithm version')
  if (input !== pvgisProjectionCacheInput(plant, [first, second])) throw new Error('cache input should use ordered changes')
  if (input === pvgisProjectionCacheInput({ ...plant, launch_date: '2025-06-29' }, [first, second])) {
    throw new Error('launch date should invalidate the cache')
  }
  if (input === pvgisProjectionCacheInput(plant, [change(1, '2025-08-10', 11), second])) {
    throw new Error('operation changes should invalidate the cache')
  }
  if (input === pvgisProjectionCacheInput(plant, [{ ...first, date: '2025-08-11' }, second])) {
    throw new Error('PV change date should invalidate the cache')
  }
  if (input === pvgisProjectionCacheInput(plant, [{ ...first, type: 'damage_replacement' }, second])) {
    throw new Error('PV change type should invalidate the cache')
  }
  if (input === pvgisProjectionCacheInput(plant, [{ ...first, id: 3 }, second])) {
    throw new Error('PV event id should invalidate the cache')
  }
  if (input !== pvgisProjectionCacheInput(plant, [{ ...first, spending_id: null }, second])) {
    throw new Error('spending linkage should not invalidate the cache')
  }
  if (!isPvgisProjectionCacheHit('same', 'same') || isPvgisProjectionCacheHit('old', 'new')) {
    throw new Error('cache hit should require an exact hash match')
  }
})

function change(id: number, date: Solaroid.Supabase.Date.Ymd, modulesAdded: number): Solaroid.Supabase.Plant.Pv.ChangeRecord {
  return {
    id,
    plant_id: plant.id,
    spending_id: id,
    date,
    type: 'improvement',
    operations: [{ kind: 'increase_field', field_id: 'south', modules_added: modulesAdded, power_added_w: modulesAdded * 410 }],
  }
}
