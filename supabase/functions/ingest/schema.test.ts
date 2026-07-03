import { Input } from './schema.ts'

Deno.test('ingest input accepts optional utility meter values', () => {
  const parsed = Input.parse({
    today: {
      production: 1,
      export: { day: 1, night: 1 },
      consumption: { day: 3, night: 4 },
      import: { day: 5, night: 6 },
      losses: { day: 0.5, night: 0.25 },
      currency: { uahUsd: 40, uahEur: 45 },
    },
    thisMonth: {
      production: 10,
      export: { day: 12, night: 8 },
      consumption: { day: 30, night: 40 },
      import: { day: 50, night: 60 },
      losses: { day: 1.5, night: 1.25 },
      monetary: {
        import: { day: 4.32, night: 2.16 },
        export: { day: 6, night: 6, taxes: [['vat', 18], ['mil', 5]] },
      },
      utility: {
        month: '2026-05',
        import: { day: 51, night: 62 },
        export: { day: 7, night: 8 },
        records: {
          current: '2026-05-31 23:59',
          previous: '2026-04-30 23:59',
        },
      },
    },
  })

  if (parsed.thisMonth.utility?.export.night !== 8) {
    throw new Error('utility export night not parsed')
  }
  if (parsed.thisMonth.utility.month !== '2026-05') {
    throw new Error('utility month not parsed')
  }
  if (parsed.thisMonth.utility.records?.previous !== '2026-04-30 23:59') {
    throw new Error('utility record dates not parsed')
  }
  if (parsed.today.losses.day !== 0.5 || parsed.thisMonth.losses.night !== 1.25) {
    throw new Error('losses not parsed')
  }
})

Deno.test('ingest input accepts payload without utility meter values', () => {
  const parsed = Input.parse({
    today: {
      production: 1,
      export: 2,
      consumption: { day: 3, night: 4 },
      import: { day: 5, night: 6 },
      losses: { day: 0.5, night: 0.25 },
      currency: { uahUsd: 40, uahEur: 45 },
    },
    thisMonth: {
      production: 10,
      export: 20,
      consumption: { day: 30, night: 40 },
      import: { day: 50, night: 60 },
      losses: { day: 1.5, night: 1.25 },
      monetary: {
        import: { day: 4.32, night: 2.16 },
        export: { value: 6, taxes: [['vat', 18], ['mil', 5]] },
      },
    },
  })

  if (parsed.thisMonth.utility !== undefined) {
    throw new Error('utility should be optional')
  }
})
