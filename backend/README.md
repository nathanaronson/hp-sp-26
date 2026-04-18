# Backend

FastAPI backend service.

## Setup

Install dependencies with [uv](https://docs.astral.sh/uv/):

```bash
uv sync
```

Copy the example env file:

```bash
cp .env.example .env
```

## Run

Development server with hot reload:

```bash
uv run fastapi dev app/main.py
```

Production server:

```bash
uv run fastapi run app/main.py
```

The API is served at `http://localhost:8000`. Interactive docs are at `/docs`.

## Test

```bash
uv run pytest
```

## Layout

```
app/
├── main.py            # FastAPI app factory
├── core/
│   └── config.py      # Settings via pydantic-settings
├── api/
│   ├── router.py      # Aggregates all route modules
│   └── routes/        # Individual route modules
└── schemas/           # Pydantic request/response models
tests/                 # Pytest suite
```
