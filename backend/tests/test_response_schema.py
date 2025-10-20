from __future__ import annotations

import importlib.util
from pathlib import Path


def _load_module(name: str, relative_path: str):
    module_path = Path(__file__).resolve().parents[1] / relative_path
    spec = importlib.util.spec_from_file_location(name, module_path)
    if spec is None or spec.loader is None:  # pragma: no cover - sécurité
        raise RuntimeError(f"Impossible de charger le module {name}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


response_schema = _load_module(
    "backend.app.widgets.response_schema", "app/widgets/response_schema.py"
)
build_widget_variables_schema = response_schema.build_widget_variables_schema


def test_build_widget_variables_schema_returns_expected_structure() -> None:
    schema = build_widget_variables_schema({"image.src": "input.src", "image.alt": "input.alt"})
    assert schema is not None
    assert schema["type"] == "object"
    assert schema["additionalProperties"] is False
    assert set(schema["properties"].keys()) == {"image.src", "image.alt"}
    assert set(schema.get("required", [])) == {"image.src", "image.alt"}

    for key, property_schema in schema["properties"].items():
        assert property_schema["type"] == ["string", "array"]
        assert property_schema["items"] == {"type": "string"}
        assert key in property_schema["description"]


def test_build_widget_variables_schema_handles_empty_mapping() -> None:
    assert build_widget_variables_schema({}) is None

