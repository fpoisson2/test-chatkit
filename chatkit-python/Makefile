.PHONY: install format format-check lint mypy pyright test coverage coverage-html coverage-report build serve-docs deploy-docs check

install:
	python -m pip install -e .[dev]

format:
	python -m ruff format
	python -m ruff check --fix

format-check:
	python -m ruff format --check

lint:
	python -m ruff check

mypy:
	python -m mypy .

pyright:
	python -m pyright

test:
	PYTHONPATH=. python -m pytest

coverage:
	PYTHONPATH=. python -m pytest --cov=chatkit --cov-report=term-missing --cov-report=html --cov-report=xml

coverage-html:
	PYTHONPATH=. python -m pytest --cov=chatkit --cov-report=html
	@echo "Coverage report generated in htmlcov/index.html"

coverage-report:
	PYTHONPATH=. python -m pytest --cov=chatkit --cov-report=term-missing

build:
	python -m build

serve-docs:
	mkdocs serve

deploy-docs:
	mkdocs gh-deploy --force --verbose

check: format-check lint pyright test
