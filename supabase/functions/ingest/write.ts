import type { SupabaseClient } from './client.ts'
import { ForbiddenError } from './errors.ts'
import { Input } from './schema.ts'
import { dateUtil } from './utils/date.ts'

function exportSplit(value: Input['today']['export']) {
  return typeof value === 'number' ? { day: value, night: 0 } : value
}

function exportPriceSplit(value: Input['thisMonth']['monetary']['export']) {
  return 'value' in value ? { day: value.value, night: 0 } : value
}

function getRows(input: Input, token: Solaroid.Supabase.Access.Token) {
  const date = dateUtil.format.ymd()
  const month = dateUtil.getMonthStart(date)
  const todayExport = exportSplit(input.today.export)
  const monthExport = exportSplit(input.thisMonth.export)
  const priceExport = exportPriceSplit(input.thisMonth.monetary.export)

  return {
    day: {
      plant_id: token.plant_id,
      date,
      production: input.today.production,
      export_day: todayExport.day,
      export_night: todayExport.night,
      import_day: input.today.import.day,
      import_night: input.today.import.night,
      consumption_day: input.today.consumption.day,
      consumption_night: input.today.consumption.night,
      uah_usd_rate: input.today.currency.uahUsd,
      uah_eur_rate: input.today.currency.uahEur,
    },
    month: {
      plant_id: token.plant_id,
      date: month,
      production: input.thisMonth.production,
      export_day: monthExport.day,
      export_night: monthExport.night,
      import_day: input.thisMonth.import.day,
      import_night: input.thisMonth.import.night,
      consumption_day: input.thisMonth.consumption.day,
      consumption_night: input.thisMonth.consumption.night,
      ...(
        input.thisMonth.utility
          ? {
            utility_import_day: input.thisMonth.utility.import.day,
            utility_import_night: input.thisMonth.utility.import.night,
            utility_export_day: input.thisMonth.utility.export.day,
            utility_export_night: input.thisMonth.utility.export.night,
          }
          : {}
      ),
    },
    tariff: {
      plant_id: token.plant_id,
      date: month,
      price_import_day: input.thisMonth.monetary.import.day,
      price_import_night: input.thisMonth.monetary.import.night,
      price_export_day: priceExport.day,
      price_export_night: priceExport.night,
      export_taxes: input.thisMonth.monetary.export.taxes,
    },
  }
}

async function write(request: Request, token: Solaroid.Supabase.Access.Token, client: SupabaseClient) {
  if (token.kind !== 'ingest') {
    throw new ForbiddenError()
  }

  const rows = getRows(Input.parse(await request.json()), token)

  await client.upsertPlantRow('days', rows.day)
  await client.upsertPlantRow('months', rows.month)
  // Storing tariff only once, no updates allowed. That's
  // intentional because tariffs don't change mid-month.
  await client.upsertPlantRow('month_tariffs', rows.tariff, true)

  return {
    date: rows.day.date,
  }
}

export {
  write,
}
