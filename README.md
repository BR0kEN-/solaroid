# Solaroid

Solaroid is a Supabase-backed solar plant ROI dashboard designed to be embedded in Home Assistant. It replaces the earlier Google Sheets-centered flow with a private data layer, a Supabase Edge Function for read/write access, and a Vite/React dashboard.

The name is `Solar` + `ROI` + `d`.

## Project Map

```text
solaroid/
  cloudflare/email-worker/     Raw signed-document email relay
  dashboard/                  React/Vite dashboard, built in HA or portal mode
  supabase/
    migrations/               Supabase schema migrations
    functions/ingest/         Edge Function used for both reads and writes
```

Main dashboard files:

- `dashboard/src/main.tsx`: UI, charts, tables, popups, view state, portal auth shell.
- `dashboard/src/Guide.tsx`: bilingual in-product guide, reference content, and view tours.
- `dashboard/src/data/supabase.ts`: API client and Supabase response mapping.
- `dashboard/src/domain/formulas.ts`: canonical electricity, payment, and ROI formulas.
- `dashboard/src/domain/types.ts`: shared dashboard domain interfaces.
- `dashboard/src/config.ts`: Vite env config.
- `dashboard/src/styles.css`: global dashboard styling.

Cloudflare Email Worker:

- `cloudflare/email-worker/src/index.ts`: validates plant aliases and relays raw RFC 5322 messages.
- `cloudflare/email-worker/README.md`: routing, secrets, deployment, downstream contract, and signed-document policy.

Main Edge Function files:

- `supabase/functions/ingest/index.ts`: function entry point.
- `supabase/functions/ingest/server.ts`: HTTP server, auth, errors, CORS.
- `supabase/functions/ingest/read.ts`: read routing and access checks.
- `supabase/functions/ingest/write.ts`: ingestion/write behavior.
- `supabase/functions/ingest/client.ts`: Supabase reads/upserts plus private monthly document storage/listing.
- `supabase/functions/ingest/pv_history.ts`: validates and reconstructs dated PV configurations.
- `supabase/functions/ingest/dam.ts`: DAM freshness check, source validation, and hourly price mapping.
- `supabase/functions/ingest/email.ts`: raw email validation, MIME parsing, and analyzed attachment selection.
- `supabase/functions/ingest/email_analysis.ts`: OpenAI PDF classification and structured report extraction.
- `supabase/functions/ingest/schema.ts`: Zod input schema.
- `supabase/functions/ingest/types.d.ts`: Deno/global Solaroid types.

## Data Flow

Home Assistant posts sensor snapshots to the Supabase Edge Function:

```text
Home Assistant -> POST /functions/v1/ingest -> Supabase tables
Portal mode -> Supabase Auth -> GET /functions/v1/ingest -> Supabase tables
HA mode -> GET /functions/v1/ingest -> Supabase tables
Mailbox -> Cloudflare Email Worker -> POST /functions/v1/ingest -> OpenAI analysis -> private document storage
```

Portal mode is intended for `https://solaroid.app`. HA mode remains static and can still be served from Home Assistant, Cloudflare, or any static host. Neither mode stores Supabase service credentials.

## Supabase Schema

Migrations live in `supabase/migrations/`.

Canonical tables:

- `plants`: plant metadata, investment, launch date, commercial date, optional electric-heating import threshold, and optional public `domain`.
- `days`: daily cumulative snapshots, including production, day/night export, import, consumption, inverter-reported losses, and daily currency rates.
- `months`: monthly cumulative snapshots, including production, day/night export, import, consumption, inverter-reported losses, and optional manual USD/UAH fallback rates.
- `month_tariffs`: immutable monthly import/export tariffs and export taxes.
- `plant_spendings`: dated additional plant costs. Supported types are `damage_replacement` and `improvement`; amounts are stored in USD.
- `plant_pv_changes`: complete plant-owned PV timeline. One launch-date `commissioning` event establishes initial fields; later events may optionally link to matching `improvement` or `damage_replacement` spending.
- `dam_prices`: hourly day-ahead market prices cached by market date, stored as UAH/kWh in `hour1` through `hour24`.
- `access_tokens`: raw Home Assistant tokens. A token owns full read/write access to its own `plant_id`.
- `access_token_read_scopes`: extra read-only plant access for a raw token, with optional scopes.
- `user_plant_access`: Supabase Auth users mapped to readable plants, with scopes for each assigned plant.

Important auth model:

- Supabase Auth users can read assigned plants only.
- Supabase Auth users can never write ingestion data.
- Dashboard users can list and open green-tariff documents only for the token's primary `plant_id`, but cannot upload or replace them.
- Extra comparison/read access never grants document listing or signed-URL access.
- Plant spending records are returned only for the token's primary plant and are omitted from comparison-plant responses.
- Own-plant projection periods retain spending IDs for investment-breakdown linking. Comparison responses omit spending IDs, PV operations, coordinates, and PV field configuration; only derived capacity and projection periods remain.
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

Ingest errors use HTTP status by ownership. Authentication, authorization, and payload failures remain `4xx`. Unknown function failures return `500`. Recognized transient Supabase Data API failures return `503`, including PostgREST connection errors and the API Gateway `PGRST303: JWT issued at future` failure. Responses expose only a generic server message; provider code, message, details, and hint stay in Edge Function logs.

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

### Monthly tariff What-if

The monthly data table has client-only `What if` editing. Selecting the net-export, import-price, or USD/UAH cell opens a vertical editor for that month's net day export price, day/night import prices, and USD/UAH rate. Tariff inputs follow the dashboard currency and are converted back to canonical UAH/kWh for calculations. Changing only the USD/UAH rate leaves those canonical tariff values unchanged.

Each override applies only to its selected month. Changing net day export price scales that month's gross day and night export prices proportionally while preserving export taxes; a zero export baseline cannot be scaled. Changing the USD/UAH rate updates that month's USD conversions and ROI, including the investment conversion when the overridden month contains the launch date. The dashboard then recalculates monthly payment, savings/ROI, totals, payback, current-month forecast cards, the Finance chart, and related formula popups. A commercial-transition month is repriced through its daily rows so the original before/after-commercial split remains intact. Exact-month tariff and exchange-rate overrides do not become future tariff values in the payback estimate.

Overrides apply immediately. Row reset removes one override; the table-level `Reset all` control appears after the first override and removes all overrides, including ones outside the visible date range. Overrides survive in-app view/range changes and data refreshes, but disappear on page reload. They are never written to Supabase. Documents, receipt reconciliation, daily data, and plant comparison always use actual values.

### Monthly documents

Selecting a month in the monthly data table opens its read-only document manager. A green-tariff document has compact actions beneath its size and MIME type. `View` opens the in-app PDF viewer; `Details` opens the structured report extracted during email ingestion. The document title itself is not interactive. Missing documents show an empty state, and documents without valid report metadata omit `Details`. The regular monthly payload includes matching files only when the requested plant is the token's primary `plant_id`; comparison plant payloads never include files. Daily rows do not open the document manager.

Receipt details have two views. `Reconciliation` compares receipt values with the month's Solaroid values for grid energy, consumer/supplier payable energy, gross/net settlement, personal income tax, and military levy. Its delta is always receipt minus Solaroid; the percentage is the unsigned delta relative to Solaroid. No tolerance, match state, or good/bad color is applied. `Receipt data` preserves the extracted fields and shows arithmetic for purchase energy, purchase-row amounts, gross, taxes, and net. Stored and calculated receipt values remain in UAH; when the dashboard is in USD mode, every receipt amount, money delta, and effective rate is displayed in USD using that month's USD/UAH rate.

Receipt metadata is reconciliation-only. It never replaces telemetry, utility-meter values, monthly payment, ROI, totals, forecasts, or charts. Solaroid expected supplier payout uses the monthly export surplus, existing day/night export proportions, configured gross export prices, and configured personal-income/military tax rates. The legacy `vat` wire/storage tax key remains supported for compatibility, but the dashboard treats and labels that value as personal income tax (`ПДФО`). Parsed values are not described as verified: extraction or source-document errors remain possible.

Document writes are email-managed. The dashboard and regular plant-token ingestion route cannot add or replace files. Accepted document and optional signature objects are limited to 20 MiB each and stored in the private `month-docs` bucket. To open a document, the dashboard sends an authorized `GET` request with its storage path in the `document` query parameter. The Edge Function requires the requested plant and storage path to match the token's primary `plant_id`, then returns a signed URL valid for 60 seconds.

### Signed-document email routing

`cloudflare/email-worker` receives `docs+<plant-id>@solaroid.app` through Cloudflare Email Routing and streams the complete email to `POST /functions/v1/ingest`. The Worker intentionally does not parse MIME.

Raw email requests use a dedicated `EMAIL_INGEST_TOKEN`, not a plant ingest token. Before reading the body or calling OpenAI, the Edge Function requires the envelope sender to match either an exact address in the optional comma-separated `EMAIL_ALLOWED_SENDER_ADDRESSES` secret or an exact domain in `EMAIL_ALLOWED_SENDER_DOMAINS`. Matching is case-insensitive; subdomains are not implicit. Gmail automatic forwarding rewrites the envelope sender to `<forwarder>+caf_=<recipient-local>=<recipient-domain>@gmail.com`; this form is accepted only when the base forwarding address is explicitly allowlisted and the encoded destination exactly matches `X-Solaroid-Recipient`. The function then validates relay metadata, parses MIME generically, and sends every valid PDF candidate to the OpenAI Responses API in one in-memory structured-analysis request. Email text and filenames are context only. The analyzer currently recognizes `green-tariff-receipt`; unknown or ambiguous messages fail without a storage write, causing the Worker to forward the original email to its fallback address.

For a recognized report, analysis returns one coupled `document` object containing its known type, settlement month, and type-specific report. `document.month` comes from the explicitly printed settlement period; `report.actDate` comes from the date printed beside the act heading. They are independent and may belong to different calendar months. A single additional attachment whose name starts with `<selected-pdf-name>.` is retained as the optional signature; its extension and MIME type are not prescribed. Multiple matching attachments are ambiguous and rejected. Ingestion upserts only final objects:

```text
<plant>/<document-type>/<YYYY-MM>
<plant>/<document-type>/<YYYY-MM>-signature
```

The dashboard requests a short-lived signed URL only after the document title is selected, then fetches the PDF and lazily loads PDF.js to render it inside the same popup. This avoids unused signed-URL requests, URL expiry before viewing, and iframe, popup, or top-level navigation restrictions in Home Assistant. The preview has an explicit back control for returning to the document list and a close control for returning to the dashboard.

`UPLOAD_TYPES` is the canonical list of known document types. A signature is an asset of its document, not another document type. Both stored objects receive only the routing metadata `plantId` and `month`; the canonical PDF also receives the nested `report` metadata. Document type comes from the storage path, and the optional signature is identified by the `-signature` path suffix, so neither `type` nor `asset` is duplicated in object metadata. Document listings exclude signatures, remove `plantId`, and expose the remaining parsed metadata with each file. Green-tariff report metadata has this structure:

```text
report
  account
  eic
  actDate
  energy
    grid
      importKwh
      exportKwh
    payable
      consumerKwh
      supplierKwh
  purchase
    greenTariff
      kwh
      priceKopPerKwh
      amountUah
    weightedPrice
      kwh
      priceKopPerKwh
      amountUah
  payment
    grossUah
    taxes
      personalIncomeUah
      militaryLevyUah
    netUah
```

Printed prices remain in kopiykas/kWh; monetary values remain in UAH. No incoming/staging objects or raw email are retained. Signature assets are excluded from dashboard document listings.

The OpenAI request uses inline PDF data, strict structured output, and `store: false`. Configure `OPENAI_API_KEY` as a Supabase Edge Function secret. `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`.

The sender gate is separate from OpenAI. Configure `EMAIL_ALLOWED_SENDER_DOMAINS` as exact comma-separated domain names without wildcards, schemes, or addresses. Optionally configure `EMAIL_ALLOWED_SENDER_ADDRESSES` with exact comma-separated envelope addresses. For Gmail automatic forwarding, allowlist the base Gmail address; the receiver recognizes its recipient-bound `+caf_=` envelope form. Both settings are Supabase Edge Function secrets; neither is a Cloudflare Worker variable nor part of an OpenAI request.

This intake preserves an optional signature attachment byte-for-byte but does not cryptographically verify it or prove that the separate PDF matches its signed content. Extracted account/EIC values are retained for later validation; they are not currently matched against plant configuration. Do not present these documents as signature-verified.

Enable Cloudflare subaddressing and route `docs@solaroid.app` to the Worker. Each mailbox forwards future supplier messages to its plant alias. Historical read messages must be forwarded individually; Cloudflare cannot pull mailbox history. Full setup, failure behavior, privacy rules, and deployment commands are in `cloudflare/email-worker/README.md`.

Current read behavior:

- No `plant`: defaults to the token's current plant.
- `plant`: allowed only for token's own plant or a read-scoped plant.
- Supabase Auth JWT reads require a confirmed user and a `user_plant_access` row.
- Supabase Auth JWT writes are forbidden.
- No `granularity`: returns full plant data plus `reads` as `{ [plantId]: scopes[] }`.
- Raw ingest tokens have full access to their own plant even though own plant is not listed in `reads`.
- Supabase Auth tokens use `reads[plantId]` for every assigned plant, including the current plant.
- Own-plant reads without `loc` redact PV coordinates. Comparison reads omit the complete PV field configuration regardless of scope and expose only derived capacity plus sanitized projection periods. PVGIS always runs against the private stored configuration before response filtering.
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
- Daily: selected-range aggregate KPIs, daily charts, daily data table with month selector and inverter losses.
- Comparison: compares two readable plants by selected daily or monthly period.

On mobile, Solaroid uses a compact icon-only bottom navigation ordered as Refresh, Overview, Comparison, and Settings. Its surface is white in HA mode, and framed HA dashboards leave safe-area spacing to Home Assistant; standalone and portal views retain their own bottom inset. Overview keeps the Monthly/Daily and range controls at the top of its content. Settings opens a bottom sheet for language and currency. The ROI recovery block exposes compact Forecast and Breakdown actions for its existing detail popups. The desktop toolbar remains unchanged.

### In-product guide

The Help icon beside Refresh opens a replayable guide in both HA and portal modes. It never opens automatically and stores no completion state. The guide hub maps Monthly, Daily, and Comparison workflows, then offers separate references for calculations and Solaroid's capability boundaries. Each view has a short spotlight tour over the live UI; selecting a tour can switch views but preserves currency, filters, and temporary What-if scenarios.

The calculation reference explains the core energy totals, balance, consumed cost, commercial payment, taxes, ROI, forecast, payback, utility-meter reconciliation, and USD conversion. It does not calculate a second set of values. Existing Info popups remain the detailed source for the actual inputs and arithmetic of a selected period.

Each monthly or daily row has one financial calculation entry point: the Info action in its ROI/PІ cell. The popup presents shared energy and tariff inputs once, then the complete net-payment calculation, electricity cost without solar, and final ROI calculation. Net-payment row values are read-only text; their column-header Info popup directs users to the matching ROI/PІ row action. Repeated values inside the unified popup are linked: hover or keyboard focus highlights every direct occurrence, while a tap locks the highlight until the same value or empty popup space is tapped. Linking is temporary presentation only and does not change formulas or stored values.

Its compact reference uses `consumed = consumed_day + consumed_night`, `import = import_day + import_night`, `export = export_day + export_night`, `losses = losses_day + losses_night`, and `balance = import - export`. Consumed cost applies the configured day/night import prices to the matching consumption zones. Commercial payment offsets import against export before charging remaining import or paying remaining export; pre-commercial export is unpaid. Net export prices remove configured personal-income and military taxes from gross prices. ROI, forecast, and payback remain derived estimates rather than separate stored measurements.

The guide states that Refresh reloads stored Supabase data rather than triggering Home Assistant measurements. Normal HA ingestion is approximately every 20 minutes, and the footer timestamp is the freshness source. It also documents that Solaroid cannot control the plant, observe losses beyond the inverter, guarantee forecasts or payback, verify preserved document signatures, persist What-if scenarios, upload documents from the dashboard, or compare plants without assigned read access. Receipt extraction remains non-authoritative and never replaces telemetry or financial calculations.

Dashboard access behavior:

- HA URLs with `#token=...` are treated as raw ingest-token access. The selected own plant has full location access.
- Portal/Auth URLs use Supabase Auth access tokens. The dashboard uses `reads[plantId]` scopes from the Edge Function, including for the selected/current plant.
- If a plant lacks `loc`, location links are hidden. Redacted `0,0` coordinates are not shown as map links.
- In the monthly PVGIS popup, panel location is shown only when the current plant has `loc`.
- Production comparison uses each plant's stage-correct PVGIS expectation. Its popup shows actual production, PVGIS expectation, `actual / expected` performance, variance, and date-weighted capacity for periods spanning an upgrade.
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
- Additional spending does not change monthly operational ROI. It increases deployed investment from its calendar month onward, reducing recovery progress and delaying payback forecasts.

The monthly investment-recovery strip shows one compact desktop row: the label with estimated payoff date, progress, then recovered/total investment. The strip date and the popup's Time left use the same month-by-month recovery projection, including production basis, consumption, commercial-period rules, tariffs, and total investment. The popup preserves the detailed calculation. The date and duration are estimates, not guarantees.

The commercial-period recovery forecast uses actual ROI for completed months, the dashboard's full-month ROI forecast for the current month, and the latest PV configuration's annual PVGIS projection for later months. PVGIS is multiplied by one normalized all-history factor: completed actual production divided by the matching stage-correct PVGIS expectation. A partial current-month snapshot is never treated as a complete month.

Currency rules:

- UAH values are native and summed directly.
- USD monthly totals convert each month using that month's USD/UAH rate.
- Monthly USD/UAH uses the latest available daily rate from that month first. If a month has no daily rates, `months.uah_usd_rate` can be filled manually as the fallback.
- Initial investment and additional spending are stored in USD. In UAH mode, initial investment uses the launch-month USD/UAH rate while each spending uses its own month's rate. A missing spending-month rate falls back to the latest positive plant rate. A matching What-if USD-rate override affects only that month's conversion.

### Additional plant spending

The dashboard is read-only for plant spending. Add an already-incurred cost through Supabase SQL or the table editor:

```sql
insert into public.plant_spendings (plant_id, date, type, amount_usd)
values ('your-plant-id', '2026-08-20', 'damage_replacement', 2000);

insert into public.plant_spendings (plant_id, date, type, amount_usd)
values ('your-plant-id', '2026-09-05', 'improvement', 750);
```

The header always shows the all-time total of the original investment plus every spending record, independent of the selected dashboard range. Its Info popup shows the launch investment, each dated additional spending with its type, the conversion rate used in UAH mode, and the total. The cumulative ROI line in the Finance chart keeps prior months on their original investment basis and applies spending from its month onward. The Finance chart's Expenses popup groups spending by type for the selected month.

`improvement` can represent any already-incurred plant upgrade. By itself it remains cost-only. Link it through `plant_pv_changes` when it commissioned added PV capacity. A `damage_replacement` spending may link to both the demount and later restoration events. One spending can therefore have several capacity events, while an event can remain unlinked until the expense exists. Spending timestamps do not replace the telemetry freshness timestamp in the footer. Future/planned costs, compensation, notes, attachments, and geometry edits are not supported.

### Capacity-aware PV history

`plant_pv_changes` is the only PV configuration source. `plants.metadata.pvs` is removed after migration. History starts with exactly one `commissioning` event on `plants.launch_date`. It has no spending and adds every launch field with full PVGIS configuration:

```json
[
  {
    "kind": "add_field",
    "field": {
      "id": "south",
      "modules": 9,
      "power": 3690,
      "azimuth": 180,
      "slope": 30,
      "elevation": 120,
      "lat": 0,
      "lng": 0,
      "loss": 14,
      "mounting": "building"
    }
  }
]
```

Every field has a stable lowercase `id` and positive `modules`; `power` is total field watts. `plant_pv_changes.operations` is always non-empty. Improvement events can add capacity to an existing field:

```json
[
  {
    "kind": "increase_field",
    "field_id": "south",
    "modules_added": 10,
    "power_added_w": 4100
  }
]
```

A newly added field stores its complete PVGIS configuration:

```json
[
  {
    "kind": "add_field",
    "field": {
      "id": "west",
      "modules": 13,
      "power": 5330,
      "azimuth": 270,
      "slope": 30,
      "elevation": 120,
      "lat": 0,
      "lng": 0,
      "loss": 14,
      "mounting": "building"
    }
  }
]
```

Damage events can partially reduce an existing field:

```json
[
  {
    "kind": "decrease_field",
    "field_id": "south",
    "modules_removed": 11,
    "power_removed_w": 4510
  }
]
```

Use `remove_field` instead when the complete field is demounted. Its full snapshot validates the field being removed and supports a later full restoration:

```json
[
  {
    "kind": "remove_field",
    "field": {
      "id": "south",
      "modules": 11,
      "power": 4510,
      "azimuth": 180,
      "slope": 30,
      "elevation": 120,
      "lat": 0,
      "lng": 0,
      "loss": 14,
      "mounting": "building"
    }
  }
]
```

Partial restoration uses `increase_field`; full-field restoration uses `add_field`. Commissioning allows only `add_field`. Improvement events allow only `increase_field` and `add_field`. Damage-replacement events allow all four operations, so restored capacity may finish above or below its previous value. `decrease_field` must leave a positive field; use `remove_field` for a complete removal. A zero-capacity stage is valid after commissioning.

Existing metadata migration:

1. Apply `20261004010000_pv_commissioning_events.sql`.
2. Verify every legacy `metadata.pvs` field has `id`, `modules`, and `power`.
3. Run `supabase/manual/move_pv_metadata_to_events.sql` before deploying the new Edge Function. The transaction reverses existing improvement operations, inserts each launch commissioning event, validates every plant, then removes `metadata.pvs`.
4. Inspect the resulting event timelines, then deploy the Edge Function and dashboard.

New physical events use their actual change date. Link a matching spending when one exists, or leave `spending_id` null:

```sql
insert into public.plant_pv_changes (plant_id, date, type, spending_id, operations)
values (
  'your-plant-id',
  '2026-03-15',
  'improvement',
  123,
  '[{"kind":"increase_field","field_id":"south","modules_added":10,"power_added_w":4100}]'::jsonb
);
```

When a later expense should own an unlinked event, attach it after inserting the spending:

```sql
update public.plant_pv_changes
set spending_id = 456
where id in (12, 13);
```

Record only completed physical changes. While replacement modules are purchased but not installed, keep only the reduction event; forecasts continue at reduced capacity. At installation, insert the restoration event. Both events may link to the same `damage_replacement` spending.

For a 9 → 19 → 32-module history, commissioning adds 9 modules; later improvement events add 10 and 13. Solaroid sorts by event date, puts commissioning first on the launch date, then uses event ID. It replays every event forward from an empty configuration. Each active configuration starts on its event date, inclusive.

Daily expectation uses the active configuration on that date. A month covered by one configuration uses its full PVGIS month. Launch and transition months are prorated by active calendar days. Historical expected lines and performance use those stage-correct values. Current-month and long-term forecasts use the weighted all-history performance factor; future months use the latest configuration. Actual telemetry, payment, savings, taxes, and historical monthly ROI are never recalculated.

The investment breakdown shows commissioning modules/kWp. Each spending lists all linked capacity events beneath its single expense row, including reduction/restoration date and transition. Unlinked events still affect projections but do not appear in the expense breakdown. The Production chart shows the selected period's capacity in its title rather than as an inspector row. Transition months show both capacities; a full outage shows `0.00 kWp`. Plant comparison receives sanitized projection periods, sums stage-correct expectation, and uses date-weighted capacity across changes.

The PVGIS cache key includes non-PV metadata, launch date, event ID/date/type/operations, projection algorithm version, and query settings. Spending amount/date/linkage do not affect it. Identical configurations share one PVGIS request; zero-capacity stages use local zero arrays without a request. A relevant change regenerates all stages while preserving top-level latest-active arrays for older clients. Missing or invalid commissioning/history never falls back to another source: actual dashboard data remains visible, while expected values and affected forecasts are disabled with a localized warning.

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
rtk make denocheck
rtk make denotest
```

Cloudflare Email Worker:

```sh
cd cloudflare/email-worker
rtk npm ci
rtk npm run check
rtk npm run dev
rtk npm run deploy
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

The addon posts on the existing anchored 20-minute schedule. Each shot reads Home Assistant and utility-meter values once, builds one payload, and sends it up to three times when the request fails with a connection/timeout error, HTTP `408`/`429`, or any `5xx`. Request timeouts increase by attempt: 30 seconds, 60 seconds, then 90 seconds. The two retry delays are approximately 20 and 70 seconds with bounded jitter. Every attempt reuses the identical payload, which is safe because the telemetry writes are idempotent upserts or updates. Ordinary `4xx` responses are not retried. A recovered retry is logged without creating a Home Assistant notification; notifications are sent only after the retry budget is exhausted.

Failure-notification titles include the Home Assistant instance name from `Settings -> System -> General`, for example `Solaroid (Bondas): Ingest failed`. Give each Home Assistant instance a distinct name so notifications sent to the same device remain identifiable. The addon reads the name once at startup; a temporary lookup failure does not stop ingestion and uses `Home Assistant` as the fallback label until restart.

> [!NOTE]
> The `dtek.endpoint` is expected to return the same structure as `POST https://ok.dtek-dnem.com.ua/api/get-common`. Include any proxy path, account alias, department, or query parameters directly in the endpoint URL. Due to the Incapsula endpoints protection, querying it is not as simple as sending the request. A decent proxy-server is a solution.
