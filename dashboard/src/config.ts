export const APP_MODE = import.meta.env.VITE_APP_MODE ?? 'ha'
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL ?? ''
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY ?? ''
export const API_PATH = import.meta.env.VITE_API_PATH ?? '/functions/v1/ingest'
export const API_URL = SUPABASE_URL ? `${SUPABASE_URL}${API_PATH}` : ''
export const FORECAST_LATITUDE = Number(import.meta.env.VITE_FORECAST_LATITUDE ?? 48.33552356395866)
export const FORECAST_LONGITUDE = Number(import.meta.env.VITE_FORECAST_LONGITUDE ?? 35.04246667027474)
