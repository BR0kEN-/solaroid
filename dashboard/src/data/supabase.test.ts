import { describe, expect, it } from 'vitest'
import { exportTotal } from '../domain/formulas'
import { toLoadedPlant } from './supabase'

const plant = {
  id: 'bondas',
  investment_usd: 12_366,
  launch_date: '2025-06-28',
  commercial_date: '2026-01-15',
  updated_at: '2026-06-06T20:04:45.872243+00:00',
}

const tariff = {
  plant_id: 'bondas',
  date: '2026-01-01',
  price_import_day: 4,
  price_import_night: 2,
  price_export_day: 6,
  price_export_night: 0,
  export_taxes: [
    ['vat', 20],
    ['mil', 5],
  ] as const,
  updated_at: '2026-06-07T00:00:00+00:00',
}

describe('Supabase data mapping', () => {
  it('uses the latest positive daily USD rate in a month before manual fallback', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        {
          plant_id: 'bondas',
          date: '2026-01-01',
          production: 100,
          export_day: 40,
          export_night: 0,
          import_day: 20,
          import_night: 10,
          consumption_day: 80,
          consumption_night: 20,
          uah_usd_rate: 99,
          updated_at: '2026-06-06T20:04:45.872243+00:00',
        },
      ],
      days: [
        day('2026-01-01', 41),
        day('2026-01-15', 0),
        day('2026-01-31', 43),
      ],
      tariffs: [tariff],
    })

    expect(loaded.rows[0].usdRate).toBe(43)
    expect(loaded.rows[0].isCommercial).toBe(false)
    expect(loaded.rows[0].consumedTotal).toBe(100)
    expect(loaded.rows[0].importTotal).toBe(30)
    expect(loaded.rows[0].balance).toBe(-10)
    expect(loaded.rows[0].exportVat).toBe(20)
    expect(loaded.rows[0].exportMilitary).toBe(5)
    expect(loaded.dailyRows.map((row) => row.usdRate)).toEqual([41, 0, 43])
  })

  it('keeps plant metadata and projection from the plant payload', () => {
    const metadata = {
      pvs: [
        {
          azimuth: 155,
          power: 11160,
          slope: 35,
          elevation: 74,
          lat: 48.33552356395866,
          lng: 35.04246667027474,
          loss: 2,
          mounting: 'building',
        },
      ],
    }
    const projection = {
      monthlyKwh: Array.from({ length: 12 }, (_, index) => index + 1),
      dailyKwh: Array.from({ length: 12 }, (_, index) => (index + 1) / 10),
    }
    const loaded = toLoadedPlant({
      plant: {
        ...plant,
        metadata,
      },
      months: [],
      days: [],
      tariffs: [],
      projection,
    })

    expect(loaded.metadata).toEqual(metadata)
    expect(loaded.projection).toEqual(projection)
  })

  it('uses manual monthly fallback when a month has no daily rates', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        {
          plant_id: 'bondas',
          date: '2025-12-01',
          production: 50,
          export_day: 5,
          export_night: 0,
          import_day: 2,
          import_night: 3,
          consumption_day: 30,
          consumption_night: 10,
          uah_usd_rate: 42.55,
        },
      ],
      days: [day('2026-01-31', 43)],
      tariffs: [],
    })

    expect(loaded.rows[0].usdRate).toBe(42.55)
  })

  it('falls back to latest positive daily rate when neither month daily nor manual rate exists', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        {
          plant_id: 'bondas',
          date: '2025-11-01',
          production: 50,
          export_day: 5,
          export_night: 0,
          import_day: 2,
          import_night: 3,
          consumption_day: 30,
          consumption_night: 10,
        },
      ],
      days: [day('2026-01-01', 41), day('2026-01-31', 43)],
      tariffs: [],
    })

    expect(loaded.rows[0].usdRate).toBe(43)
  })

  it('marks rows commercial starting on the commercial date', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        month('2026-01-01'),
        month('2026-02-01'),
      ],
      days: [day('2026-02-28', 43)],
      tariffs: [tariff, { ...tariff, date: '2026-02-01' }],
    })

    expect(loaded.rows.map((row) => row.isCommercial)).toEqual([false, true])
  })

  it('maps electric heating threshold and discounted import rates into payments', () => {
    const loaded = toLoadedPlant({
      plant: {
        ...plant,
        commercial_date: '2025-01-01',
        electric_heating_import_threshold_kwh: 2000,
      },
      months: [
        {
          plant_id: 'bondas',
          date: '2026-01-01',
          production: 0,
          export_day: 10,
          export_night: 0,
          import_day: 1170,
          import_night: 900,
          consumption_day: 1170,
          consumption_night: 900,
          uah_usd_rate: 40,
        },
      ],
      days: [day('2026-01-31', 40)],
      tariffs: [
        {
          ...tariff,
          price_import_day: 2.64,
          price_import_night: 1.32,
        },
      ],
    })

    expect(loaded.rows[0].electricHeatingThresholdKwh).toBe(2000)
    expect(loaded.rows[0].importPriceDay).toBe(2.64)
    expect(loaded.rows[0].electricityPayment).toBeCloseTo(-4335.03, 1)
    expect(loaded.dailyRows[0].electricHeatingThresholdKwh).toBeUndefined()
  })

  it('uses full utility meter values for monthly import/export calculations', () => {
    const loaded = toLoadedPlant({
      plant: {
        ...plant,
        commercial_date: '2025-01-01',
      },
      months: [
        {
          plant_id: 'bondas',
          date: '2026-03-01',
          production: 100,
          export_day: 40,
          export_night: 0,
          import_day: 20,
          import_night: 10,
          consumption_day: 80,
          consumption_night: 20,
          utility_import_day: 30,
          utility_import_night: 15,
          utility_export_day: 5,
          utility_export_night: 10,
          uah_usd_rate: 40,
        },
      ],
      days: [day('2026-03-31', 40)],
      tariffs: [
        {
          ...tariff,
          date: '2026-03-01',
        },
      ],
    })

    expect(loaded.rows[0].importDay).toBe(30)
    expect(loaded.rows[0].importNight).toBe(15)
    expect(loaded.rows[0].importTotal).toBe(45)
    expect(exportTotal(loaded.rows[0])).toBe(15)
    expect(loaded.rows[0].balance).toBe(30)
    expect(loaded.rows[0].electricityPayment).toBeCloseTo(-100)
    expect(loaded.rows[0].utilityMeter).toEqual({
      ha: {
        importDay: 20,
        importNight: 10,
        export: 40,
      },
      utility: {
        importDay: 30,
        importNight: 15,
        exportDay: 5,
        exportNight: 10,
      },
    })
  })

  it('recalculates daily import/export splits from monthly utility values', () => {
    const loaded = toLoadedPlant({
      plant: {
        ...plant,
        commercial_date: '2025-01-01',
      },
      months: [
        {
          plant_id: 'bondas',
          date: '2026-03-01',
          production: 100,
          export_day: 30,
          export_night: 0,
          import_day: 20,
          import_night: 10,
          consumption_day: 80,
          consumption_night: 20,
          utility_import_day: 30,
          utility_import_night: 20,
          utility_export_day: 20,
          utility_export_night: 4,
          uah_usd_rate: 40,
        },
      ],
      days: [
        {
          ...day('2026-03-01', 40),
          import_day: 8,
          import_night: 4,
          export_day: 20,
          export_night: 0,
        },
        {
          ...day('2026-03-02', 40),
          import_day: 12,
          import_night: 6,
          export_day: 10,
          export_night: 0,
        },
      ],
      tariffs: [
        {
          ...tariff,
          date: '2026-03-01',
        },
      ],
    })

    expect(loaded.dailyRows.map((row) => row.importDay)).toEqual([13, 17])
    expect(loaded.dailyRows.map((row) => row.importNight)).toEqual([9, 11])
    expect(loaded.dailyRows.map((row) => row.exportDay)).toEqual([15, 5])
    expect(loaded.dailyRows.map((row) => row.exportNight)).toEqual([2, 2])
    expect(loaded.dailyRows.map((row) => exportTotal(row))).toEqual([17, 7])
  })

  it('scales daily values proportionally when even utility reduction would go negative', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        {
          plant_id: 'bondas',
          date: '2026-03-01',
          production: 100,
          export_day: 10,
          export_night: 0,
          import_day: 0,
          import_night: 0,
          consumption_day: 80,
          consumption_night: 20,
          utility_import_day: 2,
          utility_import_night: 0,
          utility_export_day: 5,
          utility_export_night: 0,
        },
      ],
      days: [
        {
          ...day('2026-03-01', 40),
          import_day: 9,
          import_night: 0,
          export_day: 9,
          export_night: 0,
        },
        {
          ...day('2026-03-02', 40),
          import_day: 1,
          import_night: 0,
          export_day: 1,
          export_night: 0,
        },
      ],
      tariffs: [
        {
          ...tariff,
          date: '2026-03-01',
        },
      ],
    })

    expect(loaded.dailyRows.map((row) => row.importDay)).toEqual([1.8, 0.2])
    expect(loaded.dailyRows.map((row) => row.exportDay)).toEqual([4.5, 0.5])
  })

  it('ignores partial utility meter values', () => {
    const loaded = toLoadedPlant({
      plant,
      months: [
        {
          ...month('2026-03-01'),
          utility_import_day: 30,
          utility_import_night: 15,
          utility_export_day: 5,
        },
      ],
      days: [day('2026-03-31', 40)],
      tariffs: [
        {
          ...tariff,
          date: '2026-03-01',
        },
      ],
    })

    expect(loaded.rows[0].importDay).toBe(20)
    expect(loaded.rows[0].importNight).toBe(10)
    expect(exportTotal(loaded.rows[0])).toBe(40)
    expect(loaded.rows[0].utilityMeter).toBeUndefined()
  })

  it('does not apply electric heating threshold outside the heating season', () => {
    const loaded = toLoadedPlant({
      plant: {
        ...plant,
        commercial_date: '2025-01-01',
        electric_heating_import_threshold_kwh: 2000,
      },
      months: [
        {
          plant_id: 'bondas',
          date: '2026-06-01',
          production: 0,
          export_day: 10,
          export_night: 0,
          import_day: 1170,
          import_night: 900,
          consumption_day: 1170,
          consumption_night: 900,
          uah_usd_rate: 40,
        },
      ],
      days: [day('2026-06-30', 40)],
      tariffs: [
        {
          ...tariff,
          date: '2026-06-01',
          price_import_day: 4.32,
          price_import_night: 2.16,
        },
      ],
    })

    expect(loaded.rows[0].electricHeatingThresholdKwh).toBeUndefined()
    expect(loaded.rows[0].electricityPayment).toBeCloseTo(-6964.59, 1)
  })
})

function month(date: string) {
  return {
    plant_id: 'bondas',
    date,
    production: 100,
    export_day: 40,
    export_night: 0,
    import_day: 20,
    import_night: 10,
    consumption_day: 80,
    consumption_night: 20,
  }
}

function day(date: string, rate: number) {
  return {
    ...month(date),
    uah_usd_rate: rate,
    uah_eur_rate: 0,
  }
}
