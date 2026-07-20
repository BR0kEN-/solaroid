import { Dam } from './dam.ts'

function fullDay(value: number): number[] {
  return Array.from({ length: 24 }, (_, index) => value + index)
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status })
}

class FakeStore implements Solaroid.Supabase.Dam.Storage {
  latestUpdatedAt?: string
  rows: readonly Solaroid.Supabase.Dam.Record[] = []

  getLatestDamPriceUpdatedAt(): Promise<string | undefined> {
    return Promise.resolve(this.latestUpdatedAt)
  }

  upsertDamPrices(rows: readonly Solaroid.Supabase.Dam.Record[]): Promise<void> {
    this.rows = rows
    return Promise.resolve()
  }
}

Deno.test('DAM refresh converts UAH/MWh prices to UAH/kWh hour columns', async () => {
  const store = new FakeStore()

  const refreshed = await new Dam({
    store,
    now: new Date('2026-07-20T12:00:00.000Z'),
    fetcher: () => Promise.resolve(response({
      result: [{
        date: '2026-07-20',
        prices: fullDay(1000),
      }],
    })),
  }).refreshPrices()

  if (!refreshed) throw new Error('missing cache skipped')
  if (store.rows.length !== 1) throw new Error('DAM row not upserted')
  if (store.rows[0].date !== '2026-07-20') throw new Error('date mismatch')
  if (store.rows[0].hour1 !== 1) throw new Error('hour1 mismatch')
  if (store.rows[0].hour24 !== 1.023) throw new Error('hour24 mismatch')
})

Deno.test('DAM refresh rejects invalid result rows', async () => {
  const invalidResponses = [
    { result: [{ date: '2026-07-20', prices: [1] }] },
    { result: [{ date: 'bad', prices: fullDay(1) }] },
    { result: [{ date: '2026-07-20', prices: [...fullDay(1).slice(0, 23), 'bad'] }] },
    { data: [] },
  ]

  for (const body of invalidResponses) {
    const store = new FakeStore()

    try {
      await new Dam({
        store,
        now: new Date('2026-07-20T12:00:00.000Z'),
        fetcher: () => Promise.resolve(response(body)),
      }).refreshPrices()
    } catch {
      if (store.rows.length) throw new Error('invalid response wrote rows')
      continue
    }

    throw new Error('invalid DAM response accepted')
  }
})

Deno.test('DAM refresh skips cache newer than 50 minutes', async () => {
  const store = new FakeStore()
  store.latestUpdatedAt = '2026-07-20T11:20:00.000Z'
  let fetched = false

  const refreshed = await new Dam({
    store,
    now: new Date('2026-07-20T12:00:00.000Z'),
    fetcher: () => {
      fetched = true
      return Promise.resolve(response({ result: [] }))
    },
  }).refreshPrices()

  if (refreshed) throw new Error('fresh cache refreshed')
  if (fetched) throw new Error('fresh cache fetched source')
})

Deno.test('DAM refresh updates cache at least 50 minutes old', async () => {
  const store = new FakeStore()
  store.latestUpdatedAt = '2026-07-20T11:10:00.000Z'

  const refreshed = await new Dam({
    store,
    now: new Date('2026-07-20T12:00:00.000Z'),
    fetcher: () => Promise.resolve(response({
      result: [{ date: '2026-07-20', prices: fullDay(1) }],
    })),
  }).refreshPrices()

  if (!refreshed) throw new Error('stale cache skipped')
  if (store.rows.length !== 1) throw new Error('stale cache not updated')
})

Deno.test('DAM refresh fetches current and next month on Kyiv month boundary', async () => {
  const store = new FakeStore()
  const urls: string[] = []

  await new Dam({
    store,
    now: new Date('2026-07-30T22:30:00.000Z'),
    fetcher: (url) => {
      const value = String(url)
      urls.push(value)
      return Promise.resolve(response({
        result: [{
          date: value.endsWith('08.2026') ? '2026-08-01' : '2026-07-31',
          prices: fullDay(1),
        }],
      }))
    },
  }).refreshPrices()

  if (urls.length !== 2) throw new Error(`wrong fetch count: ${urls.length}`)
  if (!urls[0].endsWith('?date=07.2026')) throw new Error(`wrong first URL: ${urls[0]}`)
  if (!urls[1].endsWith('?date=08.2026')) throw new Error(`wrong second URL: ${urls[1]}`)
})

Deno.test('DAM source failure writes nothing', async () => {
  const store = new FakeStore()

  try {
    await new Dam({
      store,
      now: new Date('2026-07-20T12:00:00.000Z'),
      fetcher: () => Promise.resolve(response({ ok: false }, 502)),
    }).refreshPrices()
  } catch {
    if (store.rows.length) throw new Error('failed source wrote rows')
    return
  }

  throw new Error('source failure accepted')
})
