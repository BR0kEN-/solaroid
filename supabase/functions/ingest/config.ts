function requiredVar(name: string): string | never {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const SUPABASE_URL = requiredVar('SUPABASE_URL')
const { default: SUPABASE_SERVICE_ROLE_KEY } = JSON.parse(requiredVar('SUPABASE_SECRET_KEYS'))
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
}
// Formats `Y-m-d`.
const DATE_FORMATTER = new Intl.DateTimeFormat(
  'en-CA',
  {
    timeZone: Deno.env.get('PLANT_TIME_ZONE') || 'Europe/Kiev',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  },
)

export {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  CORS_HEADERS,
  DATE_FORMATTER,
}
