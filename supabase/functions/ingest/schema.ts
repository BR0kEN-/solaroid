import { z } from 'zod'

const Number = z.number()
const NumberFinite = z.number().finite()
const String = z.string().trim().min(3)

const DayNight = z.object({
  day: Number,
  night: Number,
})

const WithTaxes = {
  taxes: z.array(z.tuple([String, Number])),
}

const Period = z.object({
  production: Number,
  // Old - number, new - day/night.
  export: z.union([Number, DayNight]),
  consumption: DayNight,
  import: DayNight,
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
    utility: z.object({ import: DayNight, export: DayNight }).optional(),
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

export type Input = z.infer<typeof Input>
export type Panel = z.infer<typeof Panel>
