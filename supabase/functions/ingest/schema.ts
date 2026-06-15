import { z } from 'zod'

const Number = z.number()
const NumberFinite = z.number().finite()
const String = z.string().trim().min(3)

const DayNight = z.object({
  day: Number,
  night: Number,
})

const Period = z.object({
  production: Number,
  export: Number,
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
      export: z.object({
        value: Number,
        taxes: z.array(z.tuple([String, Number])),
      }),
    }),
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
