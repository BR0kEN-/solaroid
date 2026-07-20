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
}

export {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  DAM_API_AUTH,
  CORS_HEADERS,
}
