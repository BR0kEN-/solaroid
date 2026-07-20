.PHONY: pytest

venv:
	python3 -m venv .venv

i:
	cd addon && pip install .[dev]
	cd dashboard && npm install

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
	DAM_API_USER=test \
	DAM_API_PASS=test \
	deno test \
	--allow-env=SUPABASE_URL,SUPABASE_SECRET_KEYS,DAM_API_USER,DAM_API_PASS

ci: pytest nodetest denocheck denotest
