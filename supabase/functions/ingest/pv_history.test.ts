import { projectionForStages } from './client.ts'
import { InvalidPvHistoryError, reconstructPvConfigurationStages } from './pv_history.ts'

const baseField = field('south', 32, 13_120)

Deno.test('replays commissioning and improvements forward', () => {
  const west = { ...field('west', 13, 5_330), azimuth: 270 }
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [field('south', 9, 3_690)]),
    change(2, '2025-08-10', 'improvement', [increase('south', 10, 4_100)], 1),
    change(3, '2026-03-15', 'improvement', [{ kind: 'add_field', field: west }], 2),
  ])

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 9, power: 3_690 },
    { date: '2025-08-10', spendingId: 1, modules: 19, power: 7_790 },
    { date: '2026-03-15', spendingId: 2, modules: 32, power: 13_120 },
  ])
})

Deno.test('keeps an open damage lifecycle at reduced capacity', () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)]),
  ])

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: undefined, modules: 21, power: 8_610 },
  ])
})

Deno.test('uses open damage capacity for latest forecast arrays', async () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)]),
  ])
  const projection = await projectionForStages(stages, (fields) => {
    const modules = fields[0]?.modules ?? 0
    return Promise.resolve({
      monthlyKwh: Array.from({ length: 12 }, () => modules * 100),
      dailyKwh: Array.from({ length: 12 }, () => modules),
    })
  })

  assertEquals(projection?.monthlyKwh[0], 2_100)
})

Deno.test('restores damage above or below previous capacity exactly', () => {
  const above = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)], 7),
    change(3, '2026-11-15', 'damage_replacement', [increase('south', 12, 4_920)], 7),
  ])
  const below = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('south', 11, 4_510)], 7),
    change(3, '2026-11-15', 'damage_replacement', [increase('south', 10, 4_100)], 7),
  ])

  assertEquals(stageSummary(above).map(({ modules, power }) => ({ modules, power })), [
    { modules: 32, power: 13_120 },
    { modules: 21, power: 8_610 },
    { modules: 33, power: 13_530 },
  ])
  assertEquals(stageSummary(below).map(({ modules, power }) => ({ modules, power })), [
    { modules: 32, power: 13_120 },
    { modules: 21, power: 8_610 },
    { modules: 31, power: 12_710 },
  ])
})

Deno.test('supports full-field removal, zero plant capacity, and restoration', () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }], 7),
    change(3, '2026-11-15', 'damage_replacement', [{ kind: 'add_field', field: baseField }], 7),
  ])

  assertEquals(stageSummary(stages), [
    { date: '2025-06-01', spendingId: undefined, modules: 32, power: 13_120 },
    { date: '2026-10-01', spendingId: 7, modules: 0, power: 0 },
    { date: '2026-11-15', spendingId: 7, modules: 32, power: 13_120 },
  ])
})

Deno.test('orders same-date events by event id', () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    change(3, '2025-08-10', 'improvement', [increase('south', 2, 820)], 2),
    commissioning(1, '2025-06-01', [field('south', 9, 3_690)]),
    change(2, '2025-08-10', 'improvement', [increase('south', 1, 410)], 1),
  ])

  assertEquals(stages.map((stage) => stage.fields[0].modules), [9, 10, 12])
})

Deno.test('orders commissioning before existing launch-date events regardless of id', () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    change(1, '2025-06-01', 'improvement', [increase('south', 1, 410)], 1),
    commissioning(99, '2025-06-01', [field('south', 9, 3_690)]),
  ])

  assertEquals(stages.map((stage) => stage.fields[0].modules), [9, 10])
})

Deno.test('projects zero-capacity stages locally and reuses identical PVGIS configurations', async () => {
  const stages = reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [{ kind: 'remove_field', field: baseField }], 7),
    change(3, '2026-11-15', 'damage_replacement', [{ kind: 'add_field', field: baseField }], 7),
  ])
  const calls: (readonly Solaroid.Supabase.Plant.Pv.Field[])[] = []
  const projection = await projectionForStages(stages, (fields) => {
    calls.push(fields)
    return Promise.resolve({
      monthlyKwh: Array.from({ length: 12 }, () => 3_200),
      dailyKwh: Array.from({ length: 12 }, () => 100),
    })
  })

  assertEquals(calls.length, 1)
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

Deno.test('rejects malformed commissioning and inconsistent operations', () => {
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', []))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    commissioning(2, '2025-06-01', [field('east', 1, 410)]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-02', [baseField]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [{
    ...commissioning(1, '2025-06-01', [baseField]),
    spending_id: 7,
  }]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    change(1, '2025-06-01', 'commissioning', [increase('south', 1, 410)]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'improvement', [decrease('south', 1, 410)], 2),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [field('south', 1, 410)]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('south', 1, 410)]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [decrease('east', 1, 410)]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'damage_replacement', [{
      kind: 'remove_field', field: { ...baseField, modules: 31 },
    }]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2025-05-31', 'damage_replacement', [decrease('south', 1, 410)]),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    change(2, '2026-10-01', 'improvement', [{ kind: 'add_field', field: baseField }], 2),
  ]))
  assertInvalid(() => reconstructPvConfigurationStages('2025-06-01', [
    commissioning(1, '2025-06-01', [baseField]),
    { ...change(2, '2026-10-01', 'damage_replacement', [decrease('south', 1, 410)]), operations: [] },
  ]))
})

function field(id: string, modules: number, power: number): Solaroid.Supabase.Plant.Pv.HistoricalField {
  return {
    id, modules, power, azimuth: 180, slope: 30, elevation: 120,
    lat: 48.3, lng: 35, loss: 14, mounting: 'building',
  }
}

function commissioning(
  id: number,
  date: Solaroid.Supabase.Date.Ymd,
  fields: readonly Solaroid.Supabase.Plant.Pv.HistoricalField[],
): Solaroid.Supabase.Plant.Pv.ChangeRecord {
  return change(id, date, 'commissioning', fields.map((field) => ({ kind: 'add_field', field })))
}

function change(
  id: number,
  date: Solaroid.Supabase.Date.Ymd,
  type: Solaroid.Supabase.Plant.Pv.ChangeType,
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
