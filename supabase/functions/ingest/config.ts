function requiredVar(name: string): string | never {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const SUPABASE_URL = requiredVar('SUPABASE_URL')
const { default: SUPABASE_SERVICE_ROLE_KEY } = JSON.parse(requiredVar('SUPABASE_SECRET_KEYS'))
const DAM_API_AUTH = `Basic ${btoa(`${requiredVar('DAM_API_USER')}:${requiredVar('DAM_API_PASS')}`)}`
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
} as const
const UPLOAD_MAX_SIZE = 20_971_520 as const
const UPLOAD_TYPES = [
  'green-tariff-receipt',
] as const

export {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DAM_API_AUTH,
  CORS_HEADERS,
  UPLOAD_MAX_SIZE,
  UPLOAD_TYPES,
}
