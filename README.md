# WayAware
Crime-aware NYC navigation for walking and driving. Visualizes historical crime patterns and available incident reports along your route, provides voice alerts, and compares alternatives by travel time and modeled exposure.

## Backend

From `backend/`, using Python 3.12:

```bash
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

Check and test:

```bash
ruff check .
ruff format --check .
pytest
```

Run the API:

```bash
uvicorn app.main:app --reload --port 8000
```

`GET /health` returns `{"status": "ok"}`.
