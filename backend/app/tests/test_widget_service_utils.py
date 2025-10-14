from __future__ import annotations

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
