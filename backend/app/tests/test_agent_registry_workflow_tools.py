from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest
from agents.computer import AsyncComputer
from agents.tool import ComputerTool

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")


def _import_agent_registry(monkeypatch: pytest.MonkeyPatch) -> ModuleType:
    module_name = "backend.app.chatkit.agent_registry"
    chatkit_stub = ModuleType("backend.app.chatkit")
    chatkit_stub.__path__ = [
        str((ROOT_DIR / "backend" / "app" / "chatkit").resolve())
    ]
    tool_factory_stub = ModuleType("backend.app.tool_factory")

    def _noop(*_args: Any, **_kwargs: Any) -> Any:
        return None

    tool_factory_stub.build_computer_use_tool = _noop
    tool_factory_stub.build_file_search_tool = _noop
    tool_factory_stub.build_image_generation_tool = _noop
    tool_factory_stub.build_weather_tool = _noop
    tool_factory_stub.build_web_search_tool = _noop
    tool_factory_stub.build_widget_validation_tool = _noop
    tool_factory_stub.build_workflow_tool = _noop

    monkeypatch.setitem(sys.modules, "backend.app.chatkit", chatkit_stub)
    monkeypatch.setitem(sys.modules, "backend.app.tool_factory", tool_factory_stub)
    monkeypatch.delitem(sys.modules, module_name, raising=False)
    return importlib.import_module(module_name)


def test_coerce_agent_tools_converts_workflow_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    payload: dict[str, Any] = {"slug": "demo-workflow", "name": "Run Demo"}
    sentinel_tool = object()

    captured: dict[str, Any] = {}

    def _fake_builder(config: Any) -> Any:
        captured["config"] = config
        return sentinel_tool

    monkeypatch.setattr(agent_registry, "build_workflow_tool", _fake_builder)

    result = agent_registry._coerce_agent_tools(
        [{"type": "workflow", "workflow": payload}]
    )

    assert result == [sentinel_tool]
    assert captured["config"] == payload


def test_coerce_agent_tools_ignores_workflow_without_slug(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    called: list[Any] = []

    def _fake_builder(config: Any) -> Any:
        called.append(config)
        return object()

    monkeypatch.setattr(agent_registry, "build_workflow_tool", _fake_builder)

    caplog.set_level(logging.WARNING, logger="chatkit.server")

    result = agent_registry._coerce_agent_tools(
        [{"type": "workflow", "workflow": {"title": "No slug"}}]
    )

    assert result == []
    assert called == []
    assert "slug manquant" in caplog.text


def test_coerce_agent_tools_supports_string_workflow_reference(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    captured: dict[str, Any] = {}

    def _fake_builder(config: Any) -> Any:
        captured["config"] = config
        return "built"

    monkeypatch.setattr(agent_registry, "build_workflow_tool", _fake_builder)

    result = agent_registry._coerce_agent_tools(
        [{"type": "workflow", "workflow": "  demo-workflow  "}]
    )

    assert result == ["built"]
    assert captured["config"]["slug"] == "demo-workflow"


def test_coerce_agent_tools_merges_top_level_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    captured: dict[str, Any] = {}

    def _fake_builder(config: Any) -> Any:
        captured["config"] = config
        return "built"

    monkeypatch.setattr(agent_registry, "build_workflow_tool", _fake_builder)

    result = agent_registry._coerce_agent_tools(
        [
            {
                "type": "workflow",
                "slug": "  demo-workflow  ",
                "name": "Run Demo",
                "description": "Desc",
                "workflow": {},
            }
        ]
    )

    assert result == ["built"]
    assert captured["config"]["slug"] == "demo-workflow"
    assert captured["config"]["name"] == "Run Demo"
    assert captured["config"]["description"] == "Desc"


def test_coerce_agent_tools_logs_invalid_workflow_config(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    monkeypatch.setattr(agent_registry, "build_workflow_tool", lambda *_: object())

    caplog.set_level(logging.WARNING, logger="chatkit.server")

    result = agent_registry._coerce_agent_tools(
        [{"type": "workflow", "workflow": 12345}]
    )

    assert result == []
    assert "configuration invalide" in caplog.text


def test_coerce_agent_tools_logs_error_when_builder_fails(
    monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    def _failing_builder(config: Any) -> Any:
        raise RuntimeError("Workflow introuvable pour le slug 'missing'.")

    monkeypatch.setattr(agent_registry, "build_workflow_tool", _failing_builder)

    caplog.set_level(logging.WARNING, logger="chatkit.server")

    result = agent_registry._coerce_agent_tools(
        [{"type": "workflow", "workflow": {"slug": "missing"}}]
    )

    assert result == []
    assert "Workflow introuvable" in caplog.text


def test_get_agent_provider_binding_uses_resolver_credentials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    sentinel_provider = object()
    captured: list[Any] = []
    credentials = agent_registry.ResolvedModelProviderCredentials(
        id="provider-123",
        provider="openai",
        api_base="https://api.openai.com/v1",
        api_key="sk-provider",
    )

    monkeypatch.setattr(
        agent_registry,
        "resolve_model_provider_credentials",
        lambda provider_id, session=None: credentials
        if provider_id == "provider-123"
        else None,
    )
    monkeypatch.setattr(
        agent_registry,
        "_PROVIDER_BUILDERS",
        {"openai": lambda resolved: captured.append(resolved) or sentinel_provider},
        raising=False,
    )

    binding = agent_registry.get_agent_provider_binding("provider-123", "openai")

    assert binding is not None
    assert binding.provider is sentinel_provider
    assert binding.provider_id == "provider-123"
    assert binding.provider_slug == "openai"
    assert captured == [credentials]


def test_get_agent_provider_binding_uses_settings_when_resolver_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    monkeypatch.setattr(
        agent_registry,
        "resolve_model_provider_credentials",
        lambda *_args, **_kwargs: None,
    )

    config = agent_registry.ModelProviderConfig(
        provider="litellm",
        api_base="http://localhost:4000",
        api_key="proxy-secret",
        is_default=False,
        id="settings-id",
    )
    settings = SimpleNamespace(model_providers=(config,))
    monkeypatch.setattr(agent_registry, "get_settings", lambda: settings)

    sentinel_provider = object()
    captured: list[Any] = []
    monkeypatch.setattr(
        agent_registry,
        "_PROVIDER_BUILDERS",
        {"litellm": lambda resolved: captured.append(resolved) or sentinel_provider},
        raising=False,
    )

    binding = agent_registry.get_agent_provider_binding("settings-id", None)

    assert binding is not None
    assert binding.provider is sentinel_provider
    assert binding.provider_id == "settings-id"
    assert binding.provider_slug == "litellm"
    assert captured and captured[0].id == "settings-id"


def test_get_agent_provider_binding_returns_none_for_unknown_provider(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    monkeypatch.setattr(
        agent_registry,
        "resolve_model_provider_credentials",
        lambda *_args, **_kwargs: None,
    )
    config = agent_registry.ModelProviderConfig(
        provider="unsupported",
        api_base="https://example.invalid",
        api_key=None,
        is_default=False,
        id="unsupported-id",
    )
    settings = SimpleNamespace(model_providers=(config,))
    monkeypatch.setattr(agent_registry, "get_settings", lambda: settings)
    monkeypatch.setattr(agent_registry, "_PROVIDER_BUILDERS", {}, raising=False)

    binding = agent_registry.get_agent_provider_binding("unsupported-id", "unsupported")

    assert binding is None


def test_get_agent_provider_binding_falls_back_to_openai_builder(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    credentials = agent_registry.ResolvedModelProviderCredentials(
        id="openrouter-id",
        provider="openrouter",
        api_base="https://openrouter.invalid/v1",
        api_key="router-secret",
    )
    monkeypatch.setattr(
        agent_registry,
        "resolve_model_provider_credentials",
        lambda *_args, **_kwargs: credentials,
    )

    sentinel_provider = object()
    captured: list[Any] = []

    def _fake_builder(resolved: Any) -> Any:
        captured.append(resolved)
        return sentinel_provider

    monkeypatch.setattr(agent_registry, "_PROVIDER_BUILDERS", {}, raising=False)
    monkeypatch.setattr(agent_registry, "_build_openai_provider", _fake_builder)

    binding = agent_registry.get_agent_provider_binding("openrouter-id", "openrouter")

    assert binding is not None
    assert binding.provider is sentinel_provider
    assert binding.provider_id == "openrouter-id"
    assert binding.provider_slug == "openrouter"
    assert captured == [credentials]


class _DummyComputer(AsyncComputer):
    @property
    def environment(self) -> str:
        return "browser"

    @property
    def dimensions(self) -> tuple[int, int]:
        return (1024, 768)

    async def screenshot(self) -> str:
        return "data:image/png;base64,"

    async def click(self, x: int, y: int, button: str) -> None:  # pragma: no cover
        return None

    async def double_click(self, x: int, y: int) -> None:  # pragma: no cover
        return None

    async def scroll(
        self, x: int, y: int, scroll_x: int, scroll_y: int
    ) -> None:  # pragma: no cover
        return None

    async def type(self, text: str) -> None:  # pragma: no cover
        return None

    async def wait(self) -> None:  # pragma: no cover
        return None

    async def move(self, x: int, y: int) -> None:  # pragma: no cover
        return None

    async def keypress(self, keys: list[str]) -> None:  # pragma: no cover
        return None

    async def drag(self, path: list[tuple[int, int]]) -> None:  # pragma: no cover
        return None


def test_build_agent_kwargs_sets_truncation_for_computer_tool(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    computer_tool = ComputerTool(computer=_DummyComputer())

    monkeypatch.setattr(
        agent_registry,
        "build_computer_use_tool",
        lambda *_args, **_kwargs: computer_tool,
    )

    overrides = {
        "tools": [
            {
                "type": "computer_use",
                "computer_use": {"display_width": 800, "display_height": 600},
            }
        ],
        "model_settings": agent_registry.ModelSettings(truncation="disabled"),
    }

    result = agent_registry._build_agent_kwargs({"name": "Base"}, overrides)

    settings = result["model_settings"]
    assert isinstance(settings, agent_registry.ModelSettings)
    assert settings.truncation == "auto"
    assert result["tools"] == [computer_tool]


def test_build_agent_kwargs_adds_model_settings_when_missing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    computer_tool = ComputerTool(computer=_DummyComputer())

    monkeypatch.setattr(
        agent_registry,
        "build_computer_use_tool",
        lambda *_args, **_kwargs: computer_tool,
    )

    result = agent_registry._build_agent_kwargs(
        {"name": "Base"},
        {
            "tools": [
                {
                    "type": "computer_use_preview",
                    "computer_use": {"environment": "browser"},
                }
            ]
        },
    )

    settings = result["model_settings"]
    assert isinstance(settings, agent_registry.ModelSettings)
    assert settings.truncation == "auto"
    assert result["tools"] == [computer_tool]


def test_thread_title_agent_uses_provider_binding(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    agent_registry = _import_agent_registry(monkeypatch)

    sentinel_binding = agent_registry.AgentProviderBinding(
        provider=object(),
        provider_id="litellm-default",
        provider_slug="litellm",
    )

    monkeypatch.setattr(
        agent_registry,
        "resolve_thread_title_prompt",
        lambda: "Prompt",
    )
    monkeypatch.setattr(
        agent_registry,
        "resolve_thread_title_model",
        lambda: "gpt-oss-20b",
    )
    monkeypatch.setattr(
        agent_registry,
        "_resolve_agent_provider_binding_for_model",
        lambda model: sentinel_binding if model == "gpt-oss-20b" else None,
    )

    agent = agent_registry._build_thread_title_agent()

    assert getattr(agent, "_chatkit_provider_binding", None) is sentinel_binding
