# Solaroid

Solaroid is a Supabase-backed solar plant ROI dashboard designed to be embedded in Home Assistant. It replaces the earlier Google Sheets-centered flow with a private data layer, a Supabase Edge Function for read/write access, and a Vite/React dashboard.

The name is `Solar` + `ROI` + `d`.

## Project Map

```text
solaroid/
  dashboard/                  React/Vite dashboard
  supabase/
    migrations/               Supabase schema migrations
    functions/ingest/         Edge Function used for both reads and writes
```

Main dashboard files:

- `dashboard/src/main.tsx`: UI, charts, tables, popups, view state.
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
- `supabase/functions/ingest/schema.ts`: Zod input schema.
- `supabase/functions/ingest/types.d.ts`: Deno/global Solaroid types.

## Data Flow

Home Assistant posts sensor snapshots to the Supabase Edge Function:

```text
Home Assistant -> POST /functions/v1/ingest -> Supabase tables
Dashboard iframe -> GET /functions/v1/ingest -> Supabase tables
```

The dashboard is static and is intended to be served from Home Assistant, Cloudflare, or any static host. It does not store Supabase service credentials. It reads through the Edge Function using a bearer access token.

## Supabase Schema

Migrations live in `supabase/migrations/`.

Canonical tables:

- `plants`: plant metadata, investment, launch date, commercial date.
- `days`: daily cumulative snapshots and daily currency rates.
- `months`: monthly cumulative snapshots.
- `month_tariffs`: immutable monthly import/export tariffs and export taxes.
- `access_tokens`: one token owns read/write access to its `plant_id`.
- `access_token_read_scopes`: extra read-only plant access for a token.

Important auth model:

- There is no admin token in the app flow.
- Each access token belongs to one plant and can read/write that plant.
- Extra readable plants are attached through `access_token_read_scopes`.
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
insert into public.access_token_read_scopes (token_id, plant_id)
select id, 'bondas'
from public.access_tokens
where plant_id = 'levched';
```

## Edge Function API

Function name is currently `ingest`, but it serves both reads and writes.

All requests use:

```http
Authorization: Bearer RAW_TOKEN_VALUE
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
    readonly export: number
    readonly consumption: { readonly day: number; readonly night: number }
    readonly import: { readonly day: number; readonly night: number }
    readonly currency: { readonly uahUsd: number; readonly uahEur: number }
  }
  readonly thisMonth: {
    readonly production: number
    readonly export: number
    readonly consumption: { readonly day: number; readonly night: number }
    readonly import: { readonly day: number; readonly night: number }
    readonly monetary: {
      readonly import: { readonly day: number; readonly night: number }
      readonly export: {
        readonly value: number
        readonly taxes: readonly [string, number][]
      }
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

- No `plant`: defaults to token's own plant.
- `plant`: allowed only for token's own plant or a read-scoped plant.
- No `granularity`: returns full plant data plus `reads`.
- `granularity=YYYY-MM-DD`: returns daily row for that date.
- `granularity=YYYY-MM`: intended for range-oriented reads. Check `client.ts` before relying on this, because this behavior has changed during comparison work.
- `granularity=YYYY`: returns yearly range data.

## Dashboard

Dashboard modes:

- Monthly: ROI, finance, production, import, consumption, forecast, monthly data table.
- Daily: daily KPIs, daily charts, daily data table with month selector.
- Comparison: compares two readable plants for a selected date.

Dashboard config:

```sh
VITE_API_URL=https://PROJECT_ID.supabase.co/functions/v1/ingest
VITE_FORECAST_LATITUDE=58.33
VITE_FORECAST_LONGITUDE=34.04
```

Access token is read from the URL hash:

```text
https://host/solaroid/index.html?plant=bondas&lang=uk#token=RAW_TOKEN_VALUE
```

Query params:

- `plant`: optional requested plant. If omitted, the Edge Function uses the token's own plant.
- `lang`: `en` or `uk`.

Do not put the token into a public bundle env var. For the Home Assistant iframe use the hash token so it is not sent as a normal query parameter.

## Formulas

The dashboard calculates formulas formerly held in Google Sheets. Keep formula logic centralized in `dashboard/src/domain/formulas.ts`.

Key formulas:

```ts
consumed_total = consumed_day + consumed_night
import_total = import_day + import_night
balance = import_total - export
consumed_price = consumed_day * price_import_day + consumed_night * price_import_night
```

Payment logic:

- Before `commercial_date`, export is unpaid and does not offset import.
- If commercial export is active and export exceeds import, the net surplus earns export payout after taxes.
- Otherwise export offsets day/night import proportionally, and remaining import is charged by day/night tariff.

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
- Daily rows do not always have their own stable monthly average, so check mapping logic in `dashboard/src/data/supabase.ts`.
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
rtk npm run dev -- --host 127.0.0.1
rtk npm run preview
rtk npm run deploy:ha
rtk npm run deploy:lev
```

Edge Function:

```sh
cd supabase/functions/ingest
rtk deno check index.ts
```

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

## Home Assistant Example

Add a `rest_command` to Home Assistant:

```yaml
rest_command:
  solaroid_update:
    url: "https://PROJECT_ID.supabase.co/functions/v1/ingest"
    method: post
    timeout: 30
    content_type: "application/json"
    headers:
      Authorization: "Bearer RAW_TOKEN_VALUE"
    payload: >
      {
        "today": {
          "production": {{ states('sensor.inverter_today_production')|float(0) }},
          "export": {{ states('sensor.inverter_today_energy_export')|float(0) }},
          "consumption": {
            "day": {{ states('sensor.deye_sun_20k_lp_electricity_consumed_today_day')|float(0) }},
            "night": {{ states('sensor.deye_sun_20k_lp_electricity_consumed_today_night')|float(0) }}
          },
          "import": {
            "day": {{ states('sensor.deye_sun_20k_lp_grid_import_today_day')|float(0) }},
            "night": {{ states('sensor.deye_sun_20k_lp_grid_import_today_night')|float(0) }}
          },
          "currency": {
            "uahUsd": {{ states('sensor.usd_selling_rate_dnipro')|float(0) }},
            "uahEur": {{ states('sensor.eur_selling_rate_dnipro')|float(0) }}
          }
        },
        "thisMonth": {
          "production": {{ states('sensor.deye_sun_20k_lp_electricity_produced')|float(0) }},
          "export": {{ states('sensor.grid_export')|float(0) }},
          "consumption": {
            "day": {{ states('sensor.electricity_consumed_day')|float(0) }},
            "night": {{ states('sensor.electricity_consumed_night')|float(0) }}
          },
          "import": {
            "day": {{ states('sensor.grid_import_day')|float(0) }},
            "night": {{ states('sensor.grid_import_night')|float(0) }}
          },
          "monetary": {
            "import": {
              "day": {{ states('input_number.electricity_base_rate')|float(0) }},
              "night": {{ states('sensor.electricity_night_rate')|float(0) }}
            },
            "export": {
              "value": {{ states('input_number.electricity_export_rate')|float(0) }},
              "taxes": [
                ["vat", 18],
                ["mil", 5]
              ]
            }
          }
        }
      }
```

### Automation

Runs every 20 mins.

```yaml
mode: single
alias: Update Solaroid
description: ""
triggers:
  - trigger: time_pattern
    minutes: /20
conditions: []
actions:
  - action: rest_command.utility_payment_update_supa
    data: {}
    metadata: {}
    continue_on_error: true
    response_variable: response
  - if:
      - alias: Failed?
        condition: template
        value_template: "{{ response is not defined or response.status != 200 or not response.content.ok }}"
    then:
      - action: notify.notify_admins
        metadata: {}
        data:
          message: Update failed!
          title: 💵 Utility Payment
```

## Agent Notes

Respect these repo/user preferences:

- Use `interface` with `readonly` props for object shapes. Avoid object-shaped `type` aliases.
- Avoid semicolons unless JavaScript/TypeScript syntax requires them.
- Do not add `/// <reference path="./types.d.ts" />` to Edge Function files.
- Keep formulas in `domain/formulas.ts`; do not duplicate math in UI code unless it is display-only.
- Use `apply_patch` for manual edits.
- Be careful with user changes. This repo has often been manually edited between agent turns.
- When working on visuals, build and, when possible, inspect in a browser. The user cares strongly about mobile UX.
- Do not put private plant data into generic app code.
