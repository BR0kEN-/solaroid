import { z } from 'zod'
import { DATE_FORMATTER } from './config.ts'

const Numeric = z.number()

const DayNight = z.object({
  day: Numeric,
  night: Numeric,
})

const Period = z.object({
  production: Numeric,
  export: Numeric,
  consumption: DayNight,
  import: DayNight,
})

export const Input = z.object({
  metadata: z.object({
    plantId: z.string().trim().min(5),
  }),
  today: Period.extend({
    currency: z.object({
      uahUsd: Numeric,
      uahEur: Numeric,
    }),
  }),
  thisMonth: Period.extend({
    monetary: z.object({
      import: DayNight,
      export: z.object({
        value: Numeric,
        taxes: z.array(z.tuple([z.string().trim().min(3), Numeric])),
      }),
    }),
  }),
}).transform((input) => {
  const date = DATE_FORMATTER.format()
  const month = `${date.slice(0, 7)}-01`

  return {
    day: {
      plant_id: input.metadata.plantId,
      date,
      production: input.today.production,
      export: input.today.export,
      import_day: input.today.import.day,
      import_night: input.today.import.night,
      consumption_day: input.today.consumption.day,
      consumption_night: input.today.consumption.night,
      uah_usd_rate: input.today.currency.uahUsd,
      uah_eur_rate: input.today.currency.uahEur,
    },
    month: {
      plant_id: input.metadata.plantId,
      date: month,
      production: input.thisMonth.production,
      export: input.thisMonth.export,
      import_day: input.thisMonth.import.day,
      import_night: input.thisMonth.import.night,
      consumption_day: input.thisMonth.consumption.day,
      consumption_night: input.thisMonth.consumption.night,
    },
    tariff: {
      plant_id: input.metadata.plantId,
      date: month,
      price_import_day: input.thisMonth.monetary.import.day,
      price_import_night: input.thisMonth.monetary.import.night,
      price_export: input.thisMonth.monetary.export.value,
      export_taxes: input.thisMonth.monetary.export.taxes,
    },
  }
})

export type Input = z.infer<typeof Input>
