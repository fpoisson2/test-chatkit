from __future__ import annotations

import json

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
