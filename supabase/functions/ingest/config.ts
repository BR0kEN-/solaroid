function requiredVar(name: string): string | never {
  const value = Deno.env.get(name)
  if (!value) throw new Error(`${name} is not configured`)
  return value
}

const SUPABASE_URL = requiredVar('SUPABASE_URL')
const { default: SUPABASE_SERVICE_ROLE_KEY } = JSON.parse(requiredVar('SUPABASE_SECRET_KEYS'))
const EMAIL_INGEST_TOKEN = requiredVar('EMAIL_INGEST_TOKEN')
const OPENAI_API_KEY = requiredVar('OPENAI_API_KEY')
const OPENAI_MODEL = Deno.env.get('OPENAI_MODEL') || 'gpt-4.1-mini'
const DAM_API_AUTH = `Basic ${btoa(`${requiredVar('DAM_API_USER')}:${requiredVar('DAM_API_PASS')}`)}`
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
} as const
const UPLOAD_MAX_SIZE = 20_971_520 as const
const EMAIL_INGEST_MAX_SIZE = 26_214_400 as const
const UPLOAD_TYPES = [
  'green-tariff-receipt',
] as const

export {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  EMAIL_INGEST_TOKEN,
  OPENAI_API_KEY,
  OPENAI_MODEL,
  DAM_API_AUTH,
  CORS_HEADERS,
  UPLOAD_MAX_SIZE,
  EMAIL_INGEST_MAX_SIZE,
  UPLOAD_TYPES,
}
