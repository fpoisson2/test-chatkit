from __future__ import annotations

import importlib
import logging
import os
import sys
from pathlib import Path
from types import ModuleType
from typing import Any

import pytest

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
