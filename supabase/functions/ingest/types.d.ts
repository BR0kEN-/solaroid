declare namespace Solaroid.Supabase {
  type Json = Record<string, unknown>

  namespace Http {
    type Method = string
    type Handler = (data: unknown) => Promise<Json>
  }
}
