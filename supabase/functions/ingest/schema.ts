import { z } from 'zod'
import { dateUtil } from './utils/date.ts'

const Number = z.number()
const NumberFinite = z.number().finite()
const String = z.string().trim().min(3)

const DayNight = z.object({
  day: Number,
  night: Number,
})

const Date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const DateTime = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)

const UtilityRecordDates = z.object({
  current: DateTime,
  previous: DateTime,
})

const WithTaxes = {
  taxes: z.array(z.tuple([String, Number])),
}

const Month = z
  .string()
  .refine(dateUtil.granularity.is.month)

const Period = z.object({
  production: Number,
  // Old - number, new - day/night.
  export: z.union([Number, DayNight]),
  consumption: DayNight,
  import: DayNight,
  losses: DayNight,
})

export const Input = z.object({
  today: Period.extend({
    currency: z.object({
      uahUsd: Number,
      uahEur: Number,
    }),
  }),
  thisMonth: Period.extend({
    monetary: z.object({
      import: DayNight,
      // Old - number, new - day/night.
      export: z.union([
        z.object({ value: Number, ...WithTaxes }),
        DayNight.extend(WithTaxes),
      ]),
    }),
    utility: z.object({
      month: Month,
      import: DayNight,
      export: DayNight,
      records: UtilityRecordDates.optional(),
    }).optional(),
  }),
})

export const Panel = z.object({
  azimuth: NumberFinite,
  power: z.number().finite().positive(),
  slope: NumberFinite,
  elevation: NumberFinite,
  lat: NumberFinite,
  lng: NumberFinite,
  loss: NumberFinite,
  mounting: String,
})

const PvFieldId = z.string().trim().regex(/^[a-z0-9_-]{1,59}$/)

export const HistoricalPanel = Panel.extend({
  id: PvFieldId,
  modules: z.number().int().positive(),
})

export const PvChangeOperations = z.array(
  z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('increase_field'),
      field_id: PvFieldId,
      modules_added: z.number().int().positive(),
      power_added_w: z.number().finite().positive(),
    }),
    z.object({
      kind: z.literal('add_field'),
      field: HistoricalPanel,
    }),
  ]),
).min(1)

export const Dam = z.object({
  result: z.array(
    z.object({
      date: Date,
      prices: z.array(z.number().finite()).length(24),
    }),
  ),
})

export type Input = z.infer<typeof Input>
export type Panel = z.infer<typeof Panel>
export type HistoricalPanel = z.infer<typeof HistoricalPanel>
export type PvChangeOperations = z.infer<typeof PvChangeOperations>
export type Dam = z.infer<typeof Dam>
