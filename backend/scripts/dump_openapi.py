"""Dump the FastAPI OpenAPI schema to ../frontend/openapi.json.

Usage:  uv run python scripts/dump_openapi.py
"""

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import app  # noqa: E402

OUT = Path(__file__).resolve().parents[2] / "frontend" / "openapi.json"

OUT.parent.mkdir(parents=True, exist_ok=True)
OUT.write_text(json.dumps(app.openapi(), indent=2))
print(f"wrote {OUT.relative_to(OUT.parents[2])}")
