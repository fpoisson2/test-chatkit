import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[3]))
import os
os.environ.setdefault("DATABASE_URL", "sqlite:///")
os.environ.setdefault("OPENAI_API_KEY", "test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


import json

from backend.app.chatkit_core.outputs import (
    format_step_output,
    structured_output_as_json,
)


def test_format_step_output_formats_dict() -> None:
    payload = {"title": "Widget", "value": 42}
    formatted = format_step_output(payload)

    assert json.loads(formatted) == payload


def test_structured_output_as_json_returns_tuple() -> None:
    payload = {"name": "Example"}
    structured, text = structured_output_as_json(payload)

    assert structured == payload
    assert json.loads(text) == payload
