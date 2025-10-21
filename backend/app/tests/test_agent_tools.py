"""Tests liés à la conversion des outils Agents."""

import pytest

from agents import FunctionTool, WebSearchTool

from backend.app.chatkit import (
    _coerce_agent_tools,
    web_search_preview,
)
from backend.app.tool_factory import (
    ImageGeneration,
    ImageGenerationTool,
    validate_widget_definition,
)
import backend.app.tool_factory as tool_factory_module


def test_coerce_agent_tools_from_serialized_web_search() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "web_search",
                "web_search": {
                    "search_context_size": "high",
                    "user_location": {
                        "city": "Montréal ",
                        "country": "",
                        "region": " QC",
                    },
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, WebSearchTool)
    if hasattr(tool, "search_context_size"):
        assert getattr(tool, "search_context_size") == "high"
    if hasattr(tool, "user_location") and tool.user_location is not None:
        assert tool.user_location.get("city") == "Montréal"
        assert "country" not in tool.user_location


def test_coerce_agent_tools_uses_fallback_on_unknown_entries() -> None:
    fallback = [web_search_preview]
    tools = _coerce_agent_tools([{"type": "unknown"}], fallback)

    assert isinstance(tools, list)
    assert tools is not fallback
    assert tools == fallback


def test_coerce_agent_tools_from_serialized_file_search() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "file_search",
                "file_search": {
                    "vector_store_slug": "plan-cadre",
                    "return_documents": "full",
                    "max_num_results": "10",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FunctionTool)
    assert tool.name == "file_search_plan_cadre"


def test_coerce_agent_tools_from_weather_function() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "function",
                "function": {
                    "name": "fetch_weather",
                    "description": "Retourne la météo.",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FunctionTool)
    assert tool.name == "fetch_weather"
    assert hasattr(tool, "description")
    if hasattr(tool, "description"):
        assert "météo" in (tool.description or "")


def test_coerce_agent_tools_accepts_weather_alias() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "function",
                "function": {
                    "name": "get_weather",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FunctionTool)
    assert tool.name == "get_weather"


def test_coerce_agent_tools_from_widget_validation_function() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "function",
                "function": {
                    "name": "validate_widget",
                    "description": "Valide un widget.",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FunctionTool)
    assert tool.name == "validate_widget"
    if hasattr(tool, "description"):
        description = getattr(tool, "description") or ""
        assert "widget" in description.lower()


def test_coerce_agent_tools_accepts_widget_validation_alias() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "function",
                "function": {
                    "name": "widget_validation",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    assert isinstance(tool, FunctionTool)
    assert tool.name == "widget_validation"


def test_validate_widget_definition_success(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app import chatkit as module

    def _fake_normalize(definition: dict[str, object]) -> dict[str, object]:
        return {"normalized": True, "definition": dict(definition)}

    monkeypatch.setattr(
        tool_factory_module.WidgetLibraryService,
        "_normalize_definition",
        staticmethod(_fake_normalize),
    )

    result = validate_widget_definition({"type": "Card", "value": "Hello"})

    assert result.valid is True
    assert result.errors == []
    assert result.normalized_definition == {
        "normalized": True,
        "definition": {"type": "Card", "value": "Hello"},
    }


def test_validate_widget_definition_returns_errors(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app import chatkit as module

    def _raise_validation(_: dict[str, object]) -> dict[str, object]:
        raise module.WidgetValidationError(
            "Définition invalide",
            errors=["name: champ requis"],
        )

    monkeypatch.setattr(
        tool_factory_module.WidgetLibraryService,
        "_normalize_definition",
        staticmethod(_raise_validation),
    )

    result = validate_widget_definition({})

    assert result.valid is False
    assert result.errors == ["name: champ requis"]


def test_validate_widget_definition_accepts_json_string(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app import chatkit as module

    captured: dict[str, object] = {}

    def _capture(definition: dict[str, object]) -> dict[str, object]:
        captured.update(definition)
        return {"normalized": True}

    monkeypatch.setattr(
        tool_factory_module.WidgetLibraryService,
        "_normalize_definition",
        staticmethod(_capture),
    )

    result = validate_widget_definition("{\n  \"type\": \"Card\"\n}")

    assert result.valid is True
    assert captured == {"type": "Card"}


def test_validate_widget_definition_rejects_invalid_json() -> None:
    result = validate_widget_definition("{type: 'Card'")

    assert result.valid is False
    assert any("JSON invalide" in message for message in result.errors)


def test_validate_widget_definition_requires_json_object() -> None:
    result = validate_widget_definition("[]")

    assert result.valid is False
    assert result.errors == ["La définition de widget doit être un objet JSON."]


def test_validate_widget_definition_handles_unexpected_exception(monkeypatch: pytest.MonkeyPatch) -> None:
    from backend.app import chatkit as module

    def _crash(_: dict[str, object]) -> dict[str, object]:  # pragma: no cover - comportement simulé
        raise RuntimeError("boom")

    monkeypatch.setattr(
        tool_factory_module.WidgetLibraryService,
        "_normalize_definition",
        staticmethod(_crash),
    )

    result = validate_widget_definition({"type": "Card"})

    assert result.valid is False
    assert any("Erreur interne" in message for message in result.errors)

def test_coerce_agent_tools_accepts_empty_list() -> None:
    tools = _coerce_agent_tools([], [web_search_preview])
    assert isinstance(tools, list)
    assert tools == []


def test_coerce_agent_tools_returns_empty_when_no_fallback() -> None:
    tools = _coerce_agent_tools([{"type": "file_search"}])

    assert isinstance(tools, list)
    assert tools == []


def test_coerce_agent_tools_skips_file_search_without_slug() -> None:
    fallback = [web_search_preview]
    tools = _coerce_agent_tools(
        [
            {
                "type": "file_search",
                "file_search": {"return_documents": "full"},
            }
        ],
        fallback,
    )

    assert isinstance(tools, list)
    assert tools == fallback


def test_coerce_agent_tools_normalizes_none_value() -> None:
    tools = _coerce_agent_tools(None)

    assert isinstance(tools, list)
    assert tools == []


@pytest.mark.skipif(ImageGeneration is None, reason="ImageGeneration n'est pas disponible")
def test_coerce_agent_tools_from_image_generation_with_unknown_model() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "image_generation",
                "image_generation": {
                    "model": "gpt-image-1-mini",
                    "size": "1024x1024",
                    "quality": "high",
                    "background": "transparent",
                    "output_format": "auto",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    expected_type = ImageGenerationTool or ImageGeneration
    assert expected_type is not None
    assert isinstance(tool, expected_type)
    config = tool.tool_config if ImageGenerationTool is not None else tool
    def _read(value: object, key: str) -> object | None:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)

    assert _read(config, "model") == "gpt-image-1-mini"
    assert _read(config, "size") == "1024x1024"
    assert _read(config, "quality") == "high"
    assert _read(config, "background") == "transparent"
    assert _read(config, "output_format") == "png"


@pytest.mark.skipif(ImageGeneration is None, reason="ImageGeneration n'est pas disponible")
def test_coerce_agent_tools_normalizes_unknown_output_format() -> None:
    tools = _coerce_agent_tools(
        [
            {
                "type": "image_generation",
                "image_generation": {
                    "model": "gpt-image-1",
                    "output_format": "WEBP",
                },
            }
        ]
    )

    assert isinstance(tools, list)
    assert len(tools) == 1
    tool = tools[0]
    expected_type = ImageGenerationTool or ImageGeneration
    assert expected_type is not None
    assert isinstance(tool, expected_type)
    config = tool.tool_config if ImageGenerationTool is not None else tool

    def _read(value: object, key: str) -> object | None:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)

    assert _read(config, "output_format") == "webp"


def test_build_image_generation_tool_sets_default_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vérifie que le repli conserve un nom d'outil cohérent."""

    class _FailingImageGeneration:
        model_fields = {"type": None, "name": None, "model": None}

        def __init__(self, **_: object) -> None:  # pragma: no cover - simulé dans le test
            raise ValueError("validation stricte refusée")

        @classmethod
        def model_construct(cls, **kwargs: object):
            instance = cls.__new__(cls)
            for key, value in kwargs.items():
                setattr(instance, key, value)
            return instance

    monkeypatch.setattr(tool_factory_module, "_AgentImageGenerationConfig", None)
    monkeypatch.setattr(tool_factory_module, "ImageGeneration", _FailingImageGeneration)

    tool = tool_factory_module.build_image_generation_tool(
        {
            "image_generation": {
                "model": "fallback-model",
            }
        }
    )

    assert tool is not None
    target = tool.tool_config if ImageGenerationTool is not None else tool

    def _read(value: object, key: str) -> object | None:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)

    assert _read(target, "type") == "image_generation"
    assert _read(target, "model") == "fallback-model"
    assert getattr(tool, "name", None) == "image_generation"


def test_build_image_generation_tool_restores_missing_name(monkeypatch: pytest.MonkeyPatch) -> None:
    """Le repli doit imposer un nom même lorsque le modèle ne le déclare pas."""

    class _PartialImageGeneration:
        model_fields = {"type": None, "model": None}

        def __init__(self, **_: object) -> None:  # pragma: no cover - simulé dans le test
            raise ValueError("validation stricte refusée")

        @classmethod
        def model_construct(cls, **kwargs: object):
            instance = cls.__new__(cls)
            for key, value in kwargs.items():
                setattr(instance, key, value)
            return instance

    monkeypatch.setattr(tool_factory_module, "_AgentImageGenerationConfig", None)
    monkeypatch.setattr(tool_factory_module, "ImageGeneration", _PartialImageGeneration)

    tool = tool_factory_module.build_image_generation_tool(
        {
            "image_generation": {
                "model": "fallback-model",
            }
        }
    )

    assert tool is not None
    target = tool.tool_config if ImageGenerationTool is not None else tool

    def _read(value: object, key: str) -> object | None:
        if isinstance(value, dict):
            return value.get(key)
        return getattr(value, key, None)

    assert _read(target, "type") == "image_generation"
    assert _read(target, "model") == "fallback-model"
    assert getattr(tool, "name", None) == "image_generation"
