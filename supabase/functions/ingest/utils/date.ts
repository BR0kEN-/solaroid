// Formats `Y-m-d`.
const ymdFormatter = new Intl.DateTimeFormat(
  'en-CA',
  {
    timeZone: 'Europe/Kyiv',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  },
)

const regexps = {
  granularity: {
    year: /^\d{4}$/,
    month: /^\d{4}-\d{2}$/,
    day: /^\d{4}-\d{2}-\d{2}$/,
  },
}

function getMonthStart(value: Solaroid.Supabase.Date.Ymd | Solaroid.Supabase.Date.Ym): Solaroid.Supabase.Date.Ymd {
  return `${value.slice(0, 7)}-01` as Solaroid.Supabase.Date.Ymd
}

const dateUtil = {
  getMonthStart,
  format: {
    ymd: (value?: Intl.Formattable | number): Solaroid.Supabase.Date.Ymd => ymdFormatter.format(value) as Solaroid.Supabase.Date.Ymd
  },
  granularity: {
    is: {
      year: (value: string): value is Solaroid.Supabase.Date.Y => regexps.granularity.year.test(value),
      month: (value: string): value is Solaroid.Supabase.Date.Ym => regexps.granularity.month.test(value),
      day: (value: string): value is Solaroid.Supabase.Date.Ymd => regexps.granularity.day.test(value),
    },
  },
}

export {
  dateUtil,
}
