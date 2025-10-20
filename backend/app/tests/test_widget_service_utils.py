from __future__ import annotations

import json
from datetime import datetime
from types import SimpleNamespace

import pytest

from backend.app.widgets.service import WidgetLibraryService, WidgetValidationError


class _WidgetV2:
    def __init__(self, data: dict[str, object]) -> None:
        self._data = data

    def model_dump(self, *, mode: str = "python") -> dict[str, object]:
        assert mode in {"python", "json"}
        return self._data


class _WidgetV1:
    def __init__(self, data: dict[str, object]) -> None:
        self._data = data

    def dict(self) -> dict[str, object]:
        return self._data


def test_dump_widget_supports_pydantic_v2_style_model_dump() -> None:
    data = {"type": "Text", "value": "Hello"}
    widget = _WidgetV2(data)

    assert WidgetLibraryService._dump_widget(widget) == data


def test_dump_widget_supports_pydantic_v1_style_dict() -> None:
    data = {"type": "Markdown", "value": "**Hi**"}
    widget = _WidgetV1(data)

    assert WidgetLibraryService._dump_widget(widget) == data


def test_dump_widget_rejects_unknown_structures() -> None:
    with pytest.raises(WidgetValidationError):
        WidgetLibraryService._dump_widget("oops")  # type: ignore[arg-type]


def test_validate_widget_prefers_type_adapter(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.widgets import service as service_module

    class _Adapter:
        def __init__(self, annotation: object) -> None:
            self.annotation = annotation

        def validate_python(self, value: dict[str, object]) -> _WidgetV2:
            return _WidgetV2(value)

        def validate_json(self, value: str) -> _WidgetV2:  # pragma: no cover - non utilisé
            raise AssertionError(f"validate_json ne doit pas être appelé: {value}")

    monkeypatch.setattr(service_module, "TypeAdapter", lambda annotation: _Adapter(annotation))
    monkeypatch.setattr(service_module, "parse_obj_as", None)
    monkeypatch.setattr(service_module, "WidgetRoot", dict)

    result = WidgetLibraryService._validate_widget({"type": "Text", "value": "Hello"})

    assert isinstance(result, _WidgetV2)


def test_validate_widget_falls_back_to_parse_obj_as(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app.widgets import service as service_module

    def _fake_parse_obj_as(annotation: object, value: dict[str, object]) -> _WidgetV1:
        assert annotation is service_module.WidgetRoot
        return _WidgetV1(value)

    monkeypatch.setattr(service_module, "TypeAdapter", None)
    monkeypatch.setattr(service_module, "parse_obj_as", _fake_parse_obj_as)
    monkeypatch.setattr(service_module, "WidgetRoot", dict)

    payload = {"type": "Text", "value": "Bonjour"}
    result = WidgetLibraryService._validate_widget(json.dumps(payload))

    assert isinstance(result, _WidgetV1)


def test_from_document_accepts_json_string_definition() -> None:
    document = SimpleNamespace(
        raw_document={
            "slug": "etat-ampoule-schema",
            "title": "État d'une ampoule",
            "definition": json.dumps({"type": "Text", "value": "allumée"}),
        },
        doc_id="etat-ampoule-schema",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    entry = WidgetLibraryService._from_document(document)

    assert entry.slug == "etat-ampoule-schema"
    assert entry.definition == {"type": "Text", "value": "allumée"}


def test_from_document_rejects_invalid_json_string_definition() -> None:
    document = SimpleNamespace(
        raw_document={
            "definition": "{not-json}",
        },
        doc_id="invalid-json",
        created_at=datetime.utcnow(),
        updated_at=datetime.utcnow(),
    )

    with pytest.raises(WidgetValidationError) as exc:
        WidgetLibraryService._from_document(document)

    assert (
        "La définition du widget contient une chaîne JSON invalide."
        in exc.value.errors
    )
