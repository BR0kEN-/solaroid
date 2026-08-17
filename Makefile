.PHONY: pytest

venv:
	python3 -m venv .venv

i:
	cd addon && pip install .[dev]
	cd dashboard && npm ci
	cd cloudflare/email-worker && npm ci

pytest:
	pytest addon/tests -vvv --cov-report term

nodetest:
	cd dashboard && npm test

denocheck:
	cd supabase/functions/ingest && deno check index.ts

denotest:
	cd supabase/functions/ingest && \
	SUPABASE_URL=http://localhost \
	SUPABASE_SECRET_KEYS='{"default":"test"}' \
	EMAIL_INGEST_TOKEN=test \
	EMAIL_ALLOWED_SENDER_DOMAINS=example.com \
	EMAIL_ALLOWED_SENDER_ADDRESSES=tester@example.net \
	OPENAI_API_KEY=test \
	DAM_API_USER=test \
	DAM_API_PASS=test \
	deno test \
	--allow-env=SUPABASE_URL,SUPABASE_SECRET_KEYS,EMAIL_INGEST_TOKEN,EMAIL_ALLOWED_SENDER_DOMAINS,EMAIL_ALLOWED_SENDER_ADDRESSES,OPENAI_API_KEY,OPENAI_MODEL,DAM_API_USER,DAM_API_PASS

workercheck:
	cd cloudflare/email-worker && npm run check

ci: pytest nodetest denocheck denotest workercheck
