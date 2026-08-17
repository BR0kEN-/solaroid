# Solaroid Email Worker

Cloudflare Email Routing entry point for signed monthly documents. The Worker accepts plant-specific aliases, streams the original RFC 5322 message to a private downstream receiver, and forwards delivery failures to a verified fallback inbox.

The Worker is intentionally thin. It does not parse MIME, inspect attachments, verify signatures, call AI, access Supabase, or write monthly documents.

## Addressing

Enable Email Routing subaddressing for `solaroid.app`, then route this base address to the Worker:

```text
docs@solaroid.app
```

Each plant uses its existing lowercase ID as the subaddress:

```text
docs+<plant-id>@solaroid.app
docs+bondas@solaroid.app
```

The complete recipient regex comes from `EMAIL_RECIPIENT_PATTERN`, currently defined in `wrangler.jsonc`. It must be anchored with `^` and `$`; capture group 1 supplies the plant ID. Captured plant IDs are still independently restricted to `[a-z0-9_-]{1,59}`. The plant ID is routing metadata, not authorization. Current downstream intake extracts account/EIC values but does not yet match them against plant configuration and does not verify the signature.

## Downstream Contract

The Worker sends:

```http
POST EMAIL_INGEST_URL
Authorization: Bearer EMAIL_INGEST_TOKEN
Content-Type: message/rfc822
X-Solaroid-Plant-Id: <plant-id>
X-Solaroid-Recipient: <envelope recipient>
X-Solaroid-Envelope-From: <envelope sender>
X-Solaroid-Raw-Size: <bytes>

<original RFC 5322 message bytes>
```

Any `2xx` response means the recognized document was analyzed and stored. Repeated delivery replaces that plant/month document and also returns `2xx`. Redirects are disabled. The request times out after 60 seconds; downstream AI analysis has its own 45-second timeout.

`EMAIL_INGEST_URL` points to the existing `/functions/v1/ingest` Edge Function. `message/rfc822` POST requests use the dedicated relay token. The receiver parses MIME generically, analyzes valid PDF candidates, and currently accepts only a recognized green-tariff report. One same-name suffix attachment may be retained as its signature without assuming a particular container format. Unknown messages return non-`2xx` and are forwarded to fallback. Raw email is not persisted.

## Configuration

Runtime configuration:

- `EMAIL_INGEST_URL`: `https://PROJECT.supabase.co/functions/v1/ingest`.
- `EMAIL_INGEST_TOKEN`: receiver bearer credential used only by the Worker.
- `FALLBACK_ADDRESS`: verified Cloudflare Email Routing destination.
- `EMAIL_RECIPIENT_PATTERN`: non-secret, anchored recipient regex in `wrangler.jsonc`.

Keep `EMAIL_INGEST_URL` and `EMAIL_INGEST_TOKEN` as Worker secrets. `FALLBACK_ADDRESS` may be a secret or a dashboard text variable; `keep_vars` preserves dashboard-only variables during Wrangler deployments. Change `EMAIL_RECIPIENT_PATTERN` in `wrangler.jsonc` when the mailbox or domain changes; deployment exposes it through the Worker's `env` parameter.

For local development, create an ignored `.dev.vars` from `.dev.vars.example`. Use only synthetic email data.

```sh
rtk cp .dev.vars.example .dev.vars
rtk npm ci
rtk npm run check
```

`EMAIL_INGEST_URL` must use HTTPS in local and deployed environments.

## Local Email Simulation

Start Wrangler:

```sh
rtk npm run dev
```

With a private HTTPS development receiver configured, send the synthetic fixture to Wrangler's local email endpoint:

```sh
rtk curl --request POST \
  'http://localhost:8787/cdn-cgi/handler/email?from=sender%40example.com&to=docs%2Bbondas%40solaroid.app' \
  --data-binary '@test/fixtures/signed-document.eml'
```

The committed fixture contains dummy document and signature bytes only. Never commit or send real receipts through a test receiver.

## Deployment

Deploy the Worker before creating the Email Routing rule, so an unconfigured handler cannot receive production mail:

```sh
rtk npx wrangler login
rtk npm ci
rtk npm run deploy
rtk npx wrangler secret put EMAIL_INGEST_URL
rtk npx wrangler secret put EMAIL_INGEST_TOKEN
```

Set `FALLBACK_ADDRESS` as a verified dashboard text variable or with `wrangler secret put`. The initial deploy creates the Worker without an active email route. Each `secret put` deploys a new version with that secret. Do not activate routing until all configuration and the receiver are ready.

Configure the same random `EMAIL_INGEST_TOKEN` value plus `OPENAI_API_KEY` as Supabase Edge Function secrets, then deploy `ingest`:

```sh
rtk npx supabase secrets set --env-file supabase/functions/.env.real
rtk npx supabase functions deploy ingest
```

The ignored env file must contain `EMAIL_INGEST_TOKEN` and `OPENAI_API_KEY` alongside the existing function secrets. `OPENAI_MODEL` is optional and defaults to `gpt-4.1-mini`. Never reuse a plant ingest token.

### Deploy On Merge

Cloudflare Workers Builds can deploy this monorepo directly after a PR merges to `main`:

1. Open `solaroid-email-worker` in Cloudflare, then open **Settings > Builds**.
2. Connect the GitHub repository.
3. Set production branch to `main`.
4. Set root directory to `cloudflare/email-worker`.
5. Set build command to `npm run check`.
6. Set deploy command to `npm run deploy`.
7. Set the included build watch path to `cloudflare/email-worker/**` so unrelated monorepo merges do not redeploy it.

The committed `.node-version` pins Workers Builds to Node 22. Runtime secrets stay attached to the Worker and are not committed or supplied by pull requests. After this one-time connection, a merged Worker change deploys automatically; PR branches can upload preview versions without replacing production.

Then in Cloudflare:

1. Verify `FALLBACK_ADDRESS` as a destination address.
2. Enable subaddressing under Email Routing settings.
3. Create `docs@solaroid.app` with action `Send to a Worker`.
4. Select `solaroid-email-worker`.
5. Send a synthetic end-to-end message and confirm downstream durable intake.
6. Activate mailbox forwarding filters only after the receiver succeeds.

Cloudflare documents the [`email()` handler](https://developers.cloudflare.com/email-service/api/route-emails/email-handler/) and [local email routing](https://developers.cloudflare.com/email-service/local-development/routing/).

## Failure Behavior

- Invalid recipient alias: permanent rejection.
- Missing/invalid Worker configuration: forward original email to fallback.
- Receiver timeout, network error, redirect, or non-`2xx`: forward original email to fallback.
- Fallback unavailable or delivery failure: permanent rejection.

Logs contain only a failure category and, for downstream responses, HTTP status. They never contain plant IDs, addresses, subjects, attachment names, or message content.

## Document Intake

The receiver is generic at the MIME layer: unrelated attachment counts and formats are allowed. Valid PDF candidates are submitted together to OpenAI using inline file data, strict structured output, and `store: false`. The only recognized type is currently `green-tariff-receipt`.

For that type, analysis selects the report PDF and returns one coupled object containing type, month, and nested report data. One attachment whose filename starts with the selected PDF filename plus a suffix may be retained as its optional signature. The receiver does not assume its extension, MIME type, or container format. More than one matching attachment is rejected as ambiguous. Final paths are:

```text
<plant>/<document-type>/<YYYY-MM>
<plant>/<document-type>/<YYYY-MM>-signature
```

Both objects preserve their original bytes and receive the extracted report as nested Supabase Storage `user_metadata.report`. `UPLOAD_TYPES` contains document types only; the signature suffix identifies a secondary asset. No raw email, staging object, or deferred promotion exists. Unknown, ambiguous, malformed, or failed analysis writes nothing and triggers Worker fallback.

The receiver does not cryptographically verify signature attachments, extract embedded content, or prove that the separate PDF matches one. It also does not yet compare extracted account/EIC values with plant configuration.

## Mailbox Forwarding

Each user creates a sender/subject filter that forwards new supplier mail to the plant alias. Cloudflare cannot read historical mailbox contents. For past months, manually forward each original email individually after the receiver is active. Avoid bulk forwarding because mail clients may wrap originals as nested `.eml` attachments, which v1 does not support.
