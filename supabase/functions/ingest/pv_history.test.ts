import { projectionForStages } from './client.ts'
import { InvalidPvHistoryError, reconstructPvConfigurationStages } from './pv_history.ts'

const baseField = {
  id: 'south', modules: 32, power: 13_120, azimuth: 180, slope: 30,
  elevation: 120, lat: 48.3, lng: 35, loss: 14, mounting: 'building',
} as const

Deno.test('reconstructs improvement stages backward from current metadata', () => {
  const west = { ...baseField, id: 'west', modules: 13, power: 5_330, azimuth: 270 }
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 19, power: 7_790 }, west] },
    '2025-06-01',
    [
      change(1, '2025-08-10', 'improvement', [increase('south', 10, 4_100)], 1),
      change(2, '2026-03-15', 'improvement', [{ kind: 'add_field', field: west }], 2),
    ],
  )

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 9, power: 3_690 },
    { date: '2025-08-10', spendingId: 1, modules: 19, power: 7_790 },
    { date: '2026-03-15', spendingId: 2, modules: 32, power: 13_120 },
  ])
})

Deno.test('keeps an open damage lifecycle at reduced capacity', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 21, power: 8_610 }] },
    '2025-06-01',
    [change(10, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)])],
  )

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: undefined, modules: 21, power: 8_610 },
  ])
})

Deno.test('uses open damage capacity for the latest forecast arrays', async () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 21, power: 8_610 }] },
    '2025-06-01',
    [change(10, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)])],
  )
  const projection = await projectionForStages({}, stages, (metadata) => {
    const modules = metadata.pvs?.[0]?.modules ?? 0
    return Promise.resolve({
      monthlyKwh: Array.from({ length: 12 }, () => modules * 100),
      dailyKwh: Array.from({ length: 12 }, () => modules),
    })
  })

  assertEquals(projection?.monthlyKwh[0], 2_100)
})

Deno.test('restores partial damage to the exact recorded result', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 33, power: 13_530 }] },
    '2025-06-01',
    [
      change(10, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)], 7),
      change(11, '2026-11-15', 'damage_replacement', [increase('south', 12, 4_920)], 7),
    ],
  )

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: 7, modules: 21, power: 8_610 },
    { date: '2026-11-15', spendingId: 7, modules: 33, power: 13_530 },
  ])
})

Deno.test('allows damage restoration below the previous capacity', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 31, power: 12_710 }] },
    '2025-06-01',
    [
      change(10, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)], 7),
      change(11, '2026-11-15', 'damage_replacement', [increase('south', 10, 4_100)], 7),
    ],
  )

  assertEquals(stageSummary(stages).map(({ modules, power }) => ({ modules, power })), [
    { modules: 32, power: 13_120 },
    { modules: 21, power: 8_610 },
    { modules: 31, power: 12_710 },
  ])
})

Deno.test('supports full-field removal, zero plant capacity, and restoration', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [
      change(10, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }], 7),
      change(11, '2026-11-15', 'damage_replacement', [{ kind: 'add_field', field: baseField }], 7),
    ],
  )

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: 7, modules: 0, power: 0 },
    { date: '2026-11-15', spendingId: 7, modules: 32, power: 13_120 },
  ])
})

Deno.test('supports a currently empty plant after full-field removal', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [] },
    '2025-06-01',
    [change(10, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }])],
  )

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: undefined, modules: 0, power: 0 },
  ])
})

Deno.test('orders same-date changes by event id', () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 12, power: 4_920 }] },
    '2025-06-01',
    [
      change(2, '2025-08-10', 'improvement', [increase('south', 2, 820)], 2),
      change(1, '2025-08-10', 'improvement', [increase('south', 1, 410)], 1),
    ],
  )

  assertEquals(stages.map((stage) => stage.fields[0].modules), [9, 10, 12])
})

Deno.test('projects zero-capacity stages locally and reuses identical PVGIS configurations', async () => {
  const stages = reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [
      change(10, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }], 7),
      change(11, '2026-11-15', 'damage_replacement', [{ kind: 'add_field', field: baseField }], 7),
    ],
  )
  const calls: Solaroid.Supabase.Plant.Metadata[] = []
  const projection = await projectionForStages({}, stages, (metadata) => {
    calls.push(metadata)
    return Promise.resolve({
      monthlyKwh: Array.from({ length: 12 }, () => 3_200),
      dailyKwh: Array.from({ length: 12 }, () => 100),
    })
  })

  assertEquals(calls.length, 1)
  assertEquals(projection?.monthlyKwh, Array.from({ length: 12 }, () => 3_200))
  assertEquals(projection?.periods?.map((period) => ({
    date: period.effectiveDate,
    spendingId: period.spendingId,
    modules: period.modules,
    monthly: period.monthlyKwh[0],
  })), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, monthly: 3_200 },
    { date: '2026-10-01', spendingId: 7, modules: 0, monthly: 0 },
    { date: '2026-11-15', spendingId: 7, modules: 32, monthly: 3_200 },
  ])
})

Deno.test('rejects invalid reductions and inconsistent histories', () => {
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 21, power: 8_610 }] },
    '2025-06-01',
    [change(1, '2026-10-01', 'improvement', [decrease('south', 11, 4_510)], 1)],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 1, power: 410 }] },
    '2025-06-01',
    [
      change(1, '2026-10-01', 'damage_replacement', [decrease('south', 1, 410)]),
      change(2, '2026-11-01', 'damage_replacement', [increase('south', 1, 410)]),
    ],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [change(1, '2026-10-01', 'damage_replacement', [decrease('east', 1, 410)])],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [change(1, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }])],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, id: 'east' }] },
    '2025-06-01',
    [
      change(1, '2025-08-01', 'improvement', [{ kind: 'add_field', field: baseField }], 1),
      change(2, '2026-10-01', 'damage_replacement', [{
        kind: 'remove_field',
        field: { ...baseField, modules: 31 },
      }]),
    ],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [{ ...baseField, modules: 31, power: 12_710 }] },
    '2025-06-01',
    [change(1, '2025-05-31', 'damage_replacement', [decrease('south', 1, 410)])],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [change(1, '2026-10-01', 'improvement', [{ kind: 'add_field', field: baseField }], 1)],
  ))
  assertInvalid(() => reconstructPvConfigurationStages(
    { pvs: [baseField] },
    '2025-06-01',
    [{ ...change(1, '2026-10-01', 'damage_replacement', [decrease('south', 1, 410)]), operations: [] }],
  ))
})

function change(
  id: number,
  date: Solaroid.Supabase.Date.Ymd,
  type: Solaroid.Supabase.Plant.Spending.Type,
  operations: readonly Solaroid.Supabase.Plant.Pv.ChangeOperation[],
  spendingId: number | null = null,
): Solaroid.Supabase.Plant.Pv.ChangeRecord {
  return { id, plant_id: 'test-plant', date, type, spending_id: spendingId, operations }
}

function increase(fieldId: string, modules: number, power: number): Solaroid.Supabase.Plant.Pv.IncreaseFieldOperation {
  return { kind: 'increase_field', field_id: fieldId, modules_added: modules, power_added_w: power }
}

function decrease(fieldId: string, modules: number, power: number): Solaroid.Supabase.Plant.Pv.DecreaseFieldOperation {
  return { kind: 'decrease_field', field_id: fieldId, modules_removed: modules, power_removed_w: power }
}

function stageSummary(stages: ReturnType<typeof reconstructPvConfigurationStages>) {
  return stages.map((stage) => ({
    date: stage.effectiveDate,
    spendingId: stage.spendingId,
    modules: stage.fields.reduce((sum, field) => sum + field.modules, 0),
    power: stage.fields.reduce((sum, field) => sum + field.power, 0),
  }))
}

function assertEquals(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`)
  }
}

function assertInvalid(callback: () => unknown) {
  try {
    callback()
  } catch (error) {
    if (error instanceof InvalidPvHistoryError) return
    throw error
  }
  throw new Error('Expected InvalidPvHistoryError')
}
