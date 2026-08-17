# Solaroid Email Worker

Cloudflare Email Routing entry point for signed monthly documents. The Worker accepts plant-specific aliases, streams the original RFC 5322 message to a private downstream receiver, and forwards delivery failures to a verified fallback inbox.

The Worker is intentionally thin. It does not parse MIME, inspect attachments, verify `.p7s`, call AI, access Supabase, or write monthly documents.

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

The complete recipient regex comes from `EMAIL_RECIPIENT_PATTERN`, currently defined in `wrangler.jsonc`. It must be anchored with `^` and `$`; capture group 1 supplies the plant ID. Captured plant IDs are still independently restricted to `[a-z0-9_-]{1,59}`. The plant ID is routing metadata, not authorization. The downstream receiver must verify the signed document belongs to that plant before any write.

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

Any `2xx` response means the message was durably accepted. A duplicate should also return `2xx`. Redirects are disabled. The request times out after 15 seconds.

Do not point `EMAIL_INGEST_URL` at `/functions/v1/ingest`. That function accepts telemetry JSON or internal monthly-document multipart uploads, not raw MIME. A dedicated receiver must exist before the email route is activated.

## Configuration

Runtime configuration:

- `EMAIL_INGEST_URL`: dedicated HTTPS receiver.
- `EMAIL_INGEST_TOKEN`: receiver bearer credential used only by the Worker.
- `FALLBACK_ADDRESS`: verified Cloudflare Email Routing destination.
- `EMAIL_RECIPIENT_PATTERN`: non-secret, anchored recipient regex in `wrangler.jsonc`.

The first three values are Worker secrets. Change `EMAIL_RECIPIENT_PATTERN` in `wrangler.jsonc` when the mailbox or domain changes; deployment exposes it through the Worker's `env` parameter.

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

The committed fixture contains dummy PDF and `.p7s` bytes only. Never commit or send real receipts through a test receiver.

## Deployment

Deploy the Worker before creating the Email Routing rule, so an unconfigured handler cannot receive production mail:

```sh
rtk npx wrangler login
rtk npm ci
rtk npm run deploy
rtk npx wrangler secret put EMAIL_INGEST_URL
rtk npx wrangler secret put EMAIL_INGEST_TOKEN
rtk npx wrangler secret put FALLBACK_ADDRESS
```

The initial deploy creates the Worker without an active email route. Each `secret put` deploys a new version with that secret. Do not activate routing until all secrets and the receiver are ready.

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

## Signed Document Policy

The future receiver must preserve raw MIME, then process only verified CAdES enveloped `.p7s` documents:

1. Verify the DSTU 4145 signature with Ukrainian-compatible trust tooling.
2. Require a qualified signature, valid certificate chain/status, and qualified timestamp.
3. Require the configured signer organization EDRPOU. The inspected supplier sample uses `42082379`; this value belongs in receiver configuration, never Worker code.
4. Extract the embedded PDF only after successful verification.
5. Match signed account, EIC, and month to `X-Solaroid-Plant-Id`.
6. Deduplicate with SHA-256 of both `.p7s` and extracted PDF.
7. Store original `.p7s` as signature evidence and extracted PDF for dashboard preview.

Standalone PDFs, detached signatures, missing signatures, invalid signatures, and plant mismatches must be quarantined and must never replace a monthly document. Do not pin a person's name, certificate serial, or RNOKPP because personnel and certificates can rotate.

## Mailbox Forwarding

Each user creates a sender/subject filter that forwards new supplier mail to the plant alias. Cloudflare cannot read historical mailbox contents. For past months, manually forward each original email individually after the receiver is active. Avoid bulk forwarding because mail clients may wrap originals as nested `.eml` attachments, which v1 does not support.
