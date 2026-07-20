# Solaroid

Solaroid is a Supabase-backed solar plant ROI dashboard designed to be embedded in Home Assistant. It replaces the earlier Google Sheets-centered flow with a private data layer, a Supabase Edge Function for read/write access, and a Vite/React dashboard.

The name is `Solar` + `ROI` + `d`.

## Project Map

```text
solaroid/
  dashboard/                  React/Vite dashboard, built in HA or portal mode
  supabase/
    migrations/               Supabase schema migrations
    functions/ingest/         Edge Function used for both reads and writes
```

Main dashboard files:

- `dashboard/src/main.tsx`: UI, charts, tables, popups, view state, portal auth shell.
- `dashboard/src/data/supabase.ts`: API client and Supabase response mapping.
- `dashboard/src/domain/formulas.ts`: canonical electricity, payment, and ROI formulas.
- `dashboard/src/domain/types.ts`: shared dashboard domain interfaces.
- `dashboard/src/config.ts`: Vite env config.
- `dashboard/src/styles.css`: global dashboard styling.

Main Edge Function files:

- `supabase/functions/ingest/index.ts`: function entry point.
- `supabase/functions/ingest/server.ts`: HTTP server, auth, errors, CORS.
- `supabase/functions/ingest/read.ts`: read routing and access checks.
- `supabase/functions/ingest/write.ts`: ingestion/write behavior.
- `supabase/functions/ingest/client.ts`: Supabase queries/upserts.
- `supabase/functions/ingest/dam.ts`: DAM freshness check, source validation, and hourly price mapping.
- `supabase/functions/ingest/schema.ts`: Zod input schema.
- `supabase/functions/ingest/types.d.ts`: Deno/global Solaroid types.

## Data Flow

Home Assistant posts sensor snapshots to the Supabase Edge Function:

```text
Home Assistant -> POST /functions/v1/ingest -> Supabase tables
Portal mode -> Supabase Auth -> GET /functions/v1/ingest -> Supabase tables
HA mode -> GET /functions/v1/ingest -> Supabase tables
```

Portal mode is intended for `https://solaroid.app`. HA mode remains static and can still be served from Home Assistant, Cloudflare, or any static host. Neither mode stores Supabase service credentials.

## Supabase Schema

Migrations live in `supabase/migrations/`.

Canonical tables:

- `plants`: plant metadata, investment, launch date, commercial date, optional electric-heating import threshold, and optional public `domain`.
- `days`: daily cumulative snapshots, including production, day/night export, import, consumption, inverter-reported losses, and daily currency rates.
- `months`: monthly cumulative snapshots, including production, day/night export, import, consumption, inverter-reported losses, and optional manual USD/UAH fallback rates.
- `month_tariffs`: immutable monthly import/export tariffs and export taxes.
- `dam_prices`: hourly day-ahead market prices cached by market date, stored as UAH/kWh in `hour1` through `hour24`.
- `access_tokens`: raw Home Assistant tokens. A token owns full read/write access to its own `plant_id`.
- `access_token_read_scopes`: extra read-only plant access for a raw token, with optional scopes.
- `user_plant_access`: Supabase Auth users mapped to readable plants, with scopes for each assigned plant.

Important auth model:

- Supabase Auth users can read assigned plants only.
- Supabase Auth users can never write ingestion data.
- Raw access tokens are still used for Home Assistant ingestion.
- Each raw access token belongs to one plant and has full access to that own plant; own-plant access is not scope-limited.
- Extra readable plants are attached through `access_token_read_scopes` and are scope-limited.
- `reads` is an object shaped as `{ [plantId]: scopes[] }`.
- For raw ingest tokens, `reads` lists extra readable plants only. It does not need to include the token's own plant because own-plant access is full.
- For Supabase Auth tokens, `reads` includes every assigned readable plant, including the current/main plant. Scopes on the current plant matter for external users.
- The only current scope is `loc`. Without `loc`, plant coordinates are not disclosed.
- Writes must only affect the token's own plant.
- Reads can target the token plant or plants listed in read scopes.
- Tokens are stored as SHA-256 hashes, not raw strings.

Example token insert:

```sql
insert into public.access_tokens (plant_id, token_hash)
values ('bondas', encode(extensions.digest('RAW_TOKEN_VALUE', 'sha256'), 'hex'));
```

Example read scope:

```sql
insert into public.access_token_read_scopes (token_id, plant_id, scopes)
select id, 'bondas', '["loc"]'::jsonb
from public.access_tokens
where plant_id = 'levched';
```

Example plant assignment for a confirmed Supabase Auth user:

```sql
insert into public.user_plant_access (user_id, plant_id, scopes)
values ('AUTH_USER_ID', 'PLANT_ID', '["loc"]'::jsonb);
```

Omit `loc` to let a user read plant energy and finance data without seeing panel coordinates:

```sql
insert into public.user_plant_access (user_id, plant_id, scopes)
values ('AUTH_USER_ID', 'PLANT_ID', '[]'::jsonb);
```

Example plant domain:

```sql
update public.plants
set domain = 'ha.example.com'
where id = 'PLANT_ID';
```

## Edge Function API

Function name is currently `ingest`, but it serves both reads and writes.

Raw Home Assistant ingestion uses:

```http
Authorization: Bearer RAW_TOKEN_VALUE
```

Dashboard reads can also use a Supabase Auth JWT:

```http
Authorization: Bearer SUPABASE_AUTH_ACCESS_TOKEN
```

### Write

```http
POST /functions/v1/ingest
```

Writes/upserts:

- today snapshot into `days`
- current month snapshot into `months`
- current month tariffs into `month_tariffs` with first-insert-wins behavior

Payload shape:

```ts
interface Input {
  readonly today: {
    readonly production: number
    readonly export: number | { readonly day: number; readonly night: number }
    readonly consumption: { readonly day: number; readonly night: number }
    readonly import: { readonly day: number; readonly night: number }
    readonly losses: { readonly day: number; readonly night: number }
    readonly currency: { readonly uahUsd: number; readonly uahEur: number }
  }
  readonly thisMonth: {
    readonly production: number
    readonly export: number | { readonly day: number; readonly night: number }
    readonly consumption: { readonly day: number; readonly night: number }
    readonly import: { readonly day: number; readonly night: number }
    readonly losses: { readonly day: number; readonly night: number }
    readonly monetary: {
      readonly import: { readonly day: number; readonly night: number }
      readonly export:
        | { readonly value: number; readonly taxes: readonly [string, number][] }
        | { readonly day: number; readonly night: number; readonly taxes: readonly [string, number][] }
    }
  }
}
```

### Read

```http
GET /functions/v1/ingest
GET /functions/v1/ingest?plant=bondas
GET /functions/v1/ingest?plant=bondas&granularity=2026-06-08
GET /functions/v1/ingest?plant=bondas&granularity=2026-06
GET /functions/v1/ingest?plant=bondas&granularity=2026
```

Current read behavior:

- No `plant`: defaults to the token's current plant.
- `plant`: allowed only for token's own plant or a read-scoped plant.
- Supabase Auth JWT reads require a confirmed user and a `user_plant_access` row.
- Supabase Auth JWT writes are forbidden.
- No `granularity`: returns full plant data plus `reads` as `{ [plantId]: scopes[] }`.
- Raw ingest tokens have full access to their own plant even though own plant is not listed in `reads`.
- Supabase Auth tokens use `reads[plantId]` for every assigned plant, including the current plant.
- If `reads[plantId]` does not include `loc`, `plant.metadata.pvs[*].lat` and `lng` are set to `0` right before the response. PVGIS projection still uses the real stored coordinates before redaction.
- `granularity=YYYY-MM-DD`: returns daily row for that date.
- `granularity=YYYY-MM`: intended for range-oriented reads. Check `client.ts` before relying on this, because this behavior has changed during comparison work.
- `granularity=YYYY`: returns yearly range data.

DAM price refresh:

- Each successful telemetry ingestion checks the greatest `dam_prices.updated_at` value.
- A missing cache or cache at least 50 minutes old triggers a DAM source fetch and complete-row upsert.
- Source: `https://n8n.levko.dog/webhook/dam?date=MM.YYYY`.
- Expected response: `{ "result": [{ "date": "YYYY-MM-DD", "prices": [24 numbers] }] }`.
- Source prices are UAH/MWh. Each value is divided by `1000` before array indexes `0..23` map to UAH/kWh columns `hour1..hour24`.
- DAM refresh failure is logged without failing telemetry ingestion; the next ingestion retries.

## Dashboard

Dashboard modes:

- Monthly: ROI, finance, production, import, consumption, inverter losses, forecast, monthly data table.
- Daily: daily KPIs, daily charts, daily data table with month selector and inverter losses.
- Comparison: compares two readable plants by selected daily or monthly period.

Dashboard access behavior:

- HA URLs with `#token=...` are treated as raw ingest-token access. The selected own plant has full location access.
- Portal/Auth URLs use Supabase Auth access tokens. The dashboard uses `reads[plantId]` scopes from the Edge Function, including for the selected/current plant.
- If a plant lacks `loc`, location links are hidden. Redacted `0,0` coordinates are not shown as map links.
- In the production comparison popup, the location row is shown when at least one compared plant has `loc`. A plant without `loc` shows `—` in its location cell. Distance between plants is shown only when both plants have `loc`.
- In the monthly PVGIS popup, panel location is shown only when the current plant has `loc`.
- Production comparison also uses capacity-aware context: total capacity comes from `metadata.pvs[*].power`, yield is `kWh/kWp`, and the popup explains expected production by size plus surplus above/below that expected value.
- Comparison deltas are first plant minus second plant. For production, export, ROI, and net payment, higher is better. For import, consumed energy, and inverter losses, lower is better but the displayed sign stays mathematical. For balance, lower/negative is better and the displayed sign is inverted so a better balance reads as positive.

Dashboard config:

```sh
VITE_APP_MODE=ha
VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co
VITE_API_PATH=/functions/v1/ingest
VITE_FORECAST_LATITUDE=58.33
VITE_FORECAST_LONGITUDE=34.04
```

Access token is read from the URL hash:

```text
https://host/solaroid/index.html?plant=bondas&lang=uk#token=RAW_TOKEN_VALUE
https://host/solaroid/index.html?plant=bondas&lang=uk#access_token=SUPABASE_AUTH_ACCESS_TOKEN
```

Query params:

- `plant`: optional requested plant. If omitted, the Edge Function uses the token's own plant.
- `lang`: `en` or `uk`.

Do not put the token into a public bundle env var. For HA mode use the hash token so it is not sent as a normal query parameter.

## Portal

The portal is the same dashboard app built with the auth shell enabled.

```sh
cd dashboard
rtk npm run build:portal
rtk npm run dev:portal
```

Portal config:

```sh
VITE_APP_MODE=portal
VITE_SUPABASE_URL=https://PROJECT_ID.supabase.co
VITE_SUPABASE_ANON_KEY=SUPABASE_ANON_KEY
VITE_API_PATH=/functions/v1/ingest
```

Email/password auth config in Supabase Auth:

- Site URL: `https://solaroid.app`.
- Redirect URLs: `https://solaroid.app`, plus `http://localhost:5174` for local portal dev.
- Users sign up and sign in with email/password.
- Password reset links return to the portal and open the reset form.

Portal mode ships as an installable SPA with `manifest.webmanifest`, app icons, theme metadata, and a service worker. The service worker is registered only in portal mode.

Manual approval flow:

- User signs up in the portal.
- Admin confirms the user in Supabase Auth.
- Admin inserts one or more rows into `user_plant_access`, with scopes for each plant.
- The first assigned plant returned by the Edge Function is treated as the main plant. Other assigned plants stay available for comparison.
- Scopes still apply to the main plant for portal users. If the main plant row does not include `loc`, the dashboard hides its panel locations too.

## Formulas

The dashboard calculates formulas formerly held in Google Sheets. Keep formula logic centralized in `dashboard/src/domain/formulas.ts`.

Key formulas:

```ts
consumed_total = consumed_day + consumed_night
import_total = import_day + import_night
losses_total = losses_day + losses_night
balance = import_total - export
consumed_price = consumed_day * price_import_day + consumed_night * price_import_night
```

Losses are informational energy values reported by the inverter. They are shown as day/night splits in charts and data-table popups, but they are not used in ROI, payment, or balance formulas. The inverter can only report losses it can observe; after energy leaves the inverter, it does not know downstream wire length, cable condition, connection quality, meter-side differences, or other losses farther along the line.

Payment logic:

- Commercial rules start at the beginning of the `commercial_date` month. Before that month, export is unpaid and does not offset import.
- If commercial export is active and export exceeds import, the net surplus earns export payout after taxes.
- Otherwise export offsets day/night import proportionally, and remaining import is charged by day/night tariff.
- For plants with an electric-heating threshold, October-April monthly rows treat the tariff day/night prices from Home Assistant as the discounted electric-heating rates. The first monthly threshold kWh are charged at those rates. Any import above the threshold is split proportionally by balanced day/night import and charged at regular day/night rates. When this rule is active, `consumed_price` uses the same threshold split for `consumed_day + consumed_night`.

ROI/savings logic:

- Commercial period: `consumed_price + payment`.
- Pre-commercial period: self-consumption savings only.
- Pre-commercial ROI should not be forced to zero when solar/battery usage avoided grid import.

Important naming:

- `balance` is `import_total - export`.
- Negative balance means export surplus. This is good in the UI.
- `payment`/`electricityPayment` is cash net payment.
- `savings`/ROI is effective investment recovery, not simply `production * export_price`.

Currency rules:

- UAH values are native and summed directly.
- USD monthly totals convert each month using that month's USD/UAH rate.
- Monthly USD/UAH uses the latest available daily rate from that month first. If a month has no daily rates, `months.uah_usd_rate` can be filled manually as the fallback.
- Investment is stored in USD. In UAH mode it is converted using the launch month USD/UAH rate.

## UI Conventions

The dashboard is optimized for Home Assistant mobile use, especially iPhone-sized screens.

Keep these choices unless the user explicitly changes direction:

- Background should be transparent or neutral so Home Assistant owns the page background.
- Support light/dark mode.
- Use existing `.chart-panel`, `.chart`, `.grid`, `.legend`, and `ChartInspector` patterns for charts.
- Avoid inventing new chart visual systems when an existing chart type can be reused.
- Avoid tiny tap targets. Prefer group/month inspectors over tapping tiny bar segments.
- Do not color neutral metrics as good/bad. Production/export/import/consumption can use series colors, but red/green semantic tone should be reserved for directional metrics.
- Balance tone is inverted: negative is good, positive is bad.
- In Ukrainian UI, use `ПІ` instead of `ROI`.
- `kWh` in Ukrainian is `кВт·г`.

## Commands

The workspace instruction is to run shell commands through `rtk`.

Dashboard:

```sh
cd dashboard
rtk npm run build
rtk npm run dev
rtk npm run preview
rtk npm run deploy:ha
rtk npm run deploy:lev
```

Edge Function:

```sh
cd supabase/functions/ingest
rtk deno check index.ts
```

Agent/LLM rule: do not edit Supabase Edge Function files unless the user explicitly permits it after the agent explains why the edit is necessary. Reading, reviewing, and running `rtk deno check index.ts` are allowed when relevant.

Agent/LLM verification rule: do not run `rtk deno check index.ts` for docs-only or dashboard-style-only changes. Do not run `rtk npm run build` for docs-only changes. For CSS/style-only dashboard changes, prefer browser/visual inspection when useful instead of a full build.

Supabase CLI login and project linking:

```sh
npx supabase login
npx supabase link --project-ref PROJECT_REF
npx supabase migration list --linked
```

Find `PROJECT_REF` in Supabase Dashboard -> Project Settings -> General -> Reference ID. The link command may ask for the remote database password.

Supabase migrations are applied by the user, usually with:

```sh
npx supabase db push
```

Do not run local Supabase tests unless the user asks. The user normally applies and verifies Supabase changes manually.

## Home Assistant

1. [![Install](https://my.home-assistant.io/badges/supervisor_add_addon_repository.svg)](https://my.home-assistant.io/redirect/supervisor_add_addon_repository/?repository_url=https%3A%2F%2Fgithub.com%2FBR0kEN-%2Fsolaroid)
2. Install `Solaroid` addon.
3. Turn on `Autoupdate` & `Watchdog`.
4. Configure.
   ```yaml
   api: https://PROJECT.supabase.co
   token: SECURE1
   dtek:
     endpoint: http://192.168.68.59:54000/webhook/um?department=dnem&accountId=nest2
     phone: "+380123456789"
     password: SECURE2
     intervalMinutes: 60
   notifications:
     mobileServices:
       - notify.notify_admins
   payload:
     today:
       production: sensor.inverter_today_production
       export:
         day: sensor.storage_deye_sun_20k_lp_grid_export_today_day
         night: sensor.storage_deye_sun_20k_lp_grid_export_today_night
       consumption:
         day: sensor.deye_sun_20k_lp_electricity_consumed_today_day
         night: sensor.deye_sun_20k_lp_electricity_consumed_today_night
       import:
         day: sensor.deye_sun_20k_lp_grid_import_today_day
         night: sensor.deye_sun_20k_lp_grid_import_today_night
       losses:
         day: sensor.deye_sun_20k_lp_electricity_losses_today_day
         night: sensor.deye_sun_20k_lp_electricity_losses_today_night
       currency:
         uahUsd: sensor.usd_selling_rate_dnipro
         uahEur: sensor.eur_selling_rate_dnipro
     thisMonth:
       production: sensor.deye_sun_20k_lp_electricity_produced
       export:
         day: sensor.storage_deye_sun_20k_lp_grid_export_day
         night: sensor.storage_deye_sun_20k_lp_grid_export_night
       consumption:
         day: sensor.electricity_consumed_day
         night: sensor.electricity_consumed_night
       import:
         day: sensor.grid_import_day
         night: sensor.grid_import_night
       losses:
         day: sensor.deye_sun_20k_lp_electricity_losses_day
         night: sensor.deye_sun_20k_lp_electricity_losses_night
       monetary:
         import:
           day: input_number.electricity_base_rate
           night: sensor.electricity_night_rate
         export:
           day: input_number.electricity_export_rate
           night: input_number.electricity_export_rate
           taxes:
             - type: vat
               value: 18
             - type: mil
               value: 5
   ```
5. Start and check logs to ensure it's running.

> [!NOTE]
> The `dtek.endpoint` is expected to return the same structure as `POST https://ok.dtek-dnem.com.ua/api/get-common`. Include any proxy path, account alias, department, or query parameters directly in the endpoint URL. Due to the Incapsula endpoints protection, querying it is not as simple as sending the request. A decent proxy-server is a solution.
