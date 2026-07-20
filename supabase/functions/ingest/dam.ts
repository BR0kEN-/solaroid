import { Dam as DamSchema } from './schema.ts'
import { dateUtil } from './utils/date.ts'
import { DAM_API_AUTH } from './config.ts'

const API_URL = new URL('https://n8n.levko.dog/webhook/dam')
const REFRESH_INTERVAL_MS = 50 * 60 * 1000

interface Config {
  readonly store: Solaroid.Supabase.Dam.Storage
  readonly now?: Date
  readonly fetcher?: typeof fetch
}

function monthParam(date: Date): `${Solaroid.Supabase.Date.M}.${Solaroid.Supabase.Date.Y}` {
  return `${(date.getUTCMonth() + 1).toString().padStart(2, '0')}.${date.getUTCFullYear()}`
}

class Dam {
  protected readonly config!: Required<Config>

  constructor(options: Config) {
    this.config = {
      ...options,
      now: options.now ?? new Date(),
      fetcher: options.fetcher ?? fetch,
    }
  }

  public async refreshPrices(): Promise<boolean> {
    if (!await this.isStale()) {
      return false
    }

    const chunks = await Promise.all(
      this
        .monthsToFetch()
        .map(this.fetchMonth.bind(this)),
    )

    await this.config.store.upsertDamPrices(chunks.flat())

    return true
  }

  protected async isStale(): Promise<boolean> {
    const updatedAt = await this.config.store.getLatestDamPriceUpdatedAt()

    if (!updatedAt) {
      return true
    }

    const timestamp = new Date(updatedAt).getTime()

    return !Number.isFinite(timestamp) || this.config.now.getTime() - timestamp >= REFRESH_INTERVAL_MS
  }

  protected async fetchMonth(month: string): Promise<readonly Solaroid.Supabase.Dam.Record[]> {
    API_URL.searchParams.set('date', month)

    const response = await this.config.fetcher(
      API_URL,
      {
        headers: {
          'Authorization': DAM_API_AUTH,
        },
      },
    )

    if (!response.ok) {
      throw new Error(`DAM fetch failed for ${month}: ${response.status}`)
    }

    return DamSchema
      .parse(await response.json())
      .result
      .map(
        (record) => record.prices.reduce(
          (accumulator, price, index) => {
            // The price is UAH/MWh. Converting to UAH/kWh.
            accumulator[`hour${index + 1}`] = price / 1000
            return accumulator
          },
          {
            date: record.date,
          },
        ) as unknown as Solaroid.Supabase.Dam.Record,
      )
  }

  protected monthsToFetch(): readonly string[] {
    const today = new Date(`${dateUtil.format.ymd(this.config.now)}T00:00:00.000Z`)
    const tomorrow = new Date(today)

    tomorrow.setUTCDate(today.getUTCDate() + 1)

    const currentMonth = monthParam(today)
    const nextMonth = monthParam(tomorrow)

    return currentMonth === nextMonth ? [currentMonth] : [currentMonth, nextMonth]
  }
}

export {
  Dam,
}
