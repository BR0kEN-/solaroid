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

ci: pytest nodetest
