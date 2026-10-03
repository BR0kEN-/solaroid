import { InvalidPvHistoryError, reconstructPvConfigurationStages } from './pv_history.ts'
import { projectionForStages } from './client.ts'

const baseField = {
  id: 'south',
  modules: 32,
  power: 13_120,
  azimuth: 180,
  slope: 30,
  elevation: 120,
  lat: 48.3,
  lng: 35,
  loss: 14,
  mounting: 'building',
} as const

Deno.test('reconstructs increase and added-field stages backward from current metadata', () => {
  const west = { ...baseField, id: 'west', modules: 13, power: 5_330, azimuth: 270 }
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 19, power: 7_790 }, west] },
    '2025-06-01',
    [
      change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 10, power_added_w: 4_100 }]),
      change(2, '2026-03-15', [{ kind: 'add_field', field: west }]),
    ],
  )

  assertEquals(stages.map((stage) => ({
    date: stage.effectiveDate,
    spendingId: stage.spendingId,
    modules: stage.fields.reduce((sum, field) => sum + field.modules, 0),
    power: stage.fields.reduce((sum, field) => sum + field.power, 0),
  })), [
    { date: '2025-06-01', spendingId: undefined, modules: 9, power: 3_690 },
    { date: '2025-08-10', spendingId: 1, modules: 19, power: 7_790 },
    { date: '2026-03-15', spendingId: 2, modules: 32, power: 13_120 },
  ])
})

Deno.test('orders same-date changes by spending id', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 12, power: 4_920 }] },
    '2025-06-01',
    [
      change(2, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 2, power_added_w: 820 }]),
      change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 1, power_added_w: 410 }]),
    ],
  )

  assertEquals(stages.map((stage) => stage.fields[0].modules), [9, 10, 12])
})

Deno.test('projects every distinct stage once and preserves latest top-level arrays', async () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 19, power: 7_790 }] },
    '2025-06-01',
    [change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 10, power_added_w: 4_100 }])],
  )
  const calls: Solaroid.Supabase.Plant.Metadata[] = []
  const projection = await projectionForStages({}, stages, (metadata) => {
    calls.push(metadata)
    const value = calls.length * 100
    return Promise.resolve({
      monthlyKwh: Array.from({ length: 12 }, () => value),
      dailyKwh: Array.from({ length: 12 }, () => value / 30),
    })
  })

  assertEquals(calls.map((metadata) => metadata.pvs?.[0].modules), [9, 19])
  assertEquals(projection?.monthlyKwh, Array.from({ length: 12 }, () => 200))
  assertEquals(projection?.periods?.map((period) => ({
    date: period.effectiveDate,
    spendingId: period.spendingId,
    modules: period.modules,
    capacityKwp: period.capacityKwp,
  })), [
    { date: '2025-06-01', spendingId: undefined, modules: 9, capacityKwp: 3.69 },
    { date: '2025-08-10', spendingId: 1, modules: 19, capacityKwp: 7.79 },
  ])
})

Deno.test('rejects malformed histories', () => {
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField, baseField] },
    '2025-06-01',
    [change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 1, power_added_w: 410 }])],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'east', modules_added: 1, power_added_w: 410 }])],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 1, power: 410 }] },
    '2025-06-01',
    [change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 1, power_added_w: 410 }])],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [{ ...change(1, '2025-05-31', [{ kind: 'increase_field', field_id: 'south', modules_added: 1, power_added_w: 410 }]) }],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [{
      ...change(1, '2025-08-10', [{ kind: 'increase_field', field_id: 'south', modules_added: 1, power_added_w: 410 }]),
      spending: { id: 1, date: '2025-08-10', type: 'damage_replacement' },
    }],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [change(1, '2025-08-10', [{ kind: 'add_field', field: baseField }])],
  ))
  assertThrows(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [{ ...change(1, '2025-08-10', []), operations: [] }],
  ))
})

function change(
  spendingId: number,
  date: Solaroid.Supabase.Date.Ymd,
  operations: readonly Solaroid.Supabase.Plant.Pv.ChangeOperation[],
): Solaroid.Supabase.Plant.Pv.ChangeRecord {
  return {
    spending_id: spendingId,
    operations,
    spending: { id: spendingId, date, type: 'improvement' },
  }
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function assertThrows(callback: () => unknown) {
  try {
    callback()
  } catch (error) {
    if (error instanceof InvalidPvHistoryError) return
    throw error
  }
  throw new Error('Expected InvalidPvHistoryError')
}
