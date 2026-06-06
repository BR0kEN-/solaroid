import { z } from 'zod'

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
})

export type Input = z.infer<typeof Input>
