# Solaroid

`Solar` + `ROI` + `d` to make it a fun word.

## Supabase

### Edge Function

#### Ingest

Receives Home Assistant events and writes them into Supabase:

- upserts `days`
- upserts `months`
- inserts `month_tariffs` once per `(plant_id, date)`

Required function secrets:

```sh
supabase secrets set INGEST_TOKEN=...
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...
```

`SUPABASE_URL` is provided by Supabase automatically.

Home Assistant can authenticate with either:

```http
Authorization: Bearer <INGEST_TOKEN>
```
