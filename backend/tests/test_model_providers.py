from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

import pytest
from agents import Agent, Runner

BACKEND_ROOT = Path(__file__).resolve().parents[1]
if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))

config = import_module("app.config")
configure_model_provider = import_module(
    "app.model_providers"
).configure_model_provider


@pytest.mark.usefixtures("monkeypatch")
def test_runner_uses_litellm_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """Vérifie que le client LiteLLM configuré est utilisé par Runner.run_streamed."""

    monkeypatch.setenv("MODEL_PROVIDER", "litellm")
    monkeypatch.setenv("LITELLM_API_BASE", "https://litellm.example")
    monkeypatch.setenv("LITELLM_API_KEY", "sk-litel")
    monkeypatch.delenv("MODEL_API_BASE", raising=False)
    monkeypatch.delenv("MODEL_API_KEY_ENV", raising=False)

    config.get_settings.cache_clear()
    try:
        settings = config.get_settings()
        assert settings.model_provider == "litellm"

        from agents.models import _openai_shared as openai_shared

        original_client = openai_shared.get_default_openai_client()
        monkeypatch.setattr(
            openai_shared,
            "_default_openai_client",
            original_client,
        )

        captured_clients = []
        original_set_client = openai_shared.set_default_openai_client

        def _capture(client):
            captured_clients.append(client)
            original_set_client(client)

        monkeypatch.setattr(openai_shared, "set_default_openai_client", _capture)

        configure_model_provider(settings)

        assert captured_clients, "Le client LiteLLM devrait être configuré."
        client = captured_clients[-1]
        expected_base = "https://litellm.example/v1"
        assert str(client.base_url).rstrip("/") == expected_base
        assert client.api_key == "sk-litel"

        recorded_base: dict[str, str | None] = {}

        from agents.run import AgentRunner

        def _fake_run_streamed(self, *args, **kwargs):
            active_client = openai_shared.get_default_openai_client()
            active_base = getattr(active_client, "base_url", None)
            recorded_base["value"] = (
                str(active_base).rstrip("/") if active_base is not None else None
            )
            return SimpleNamespace(new_items=[])

        monkeypatch.setattr(AgentRunner, "run_streamed", _fake_run_streamed)

        agent = Agent(name="dummy")
        Runner.run_streamed(agent, input="ping")

        assert recorded_base.get("value") == expected_base
    finally:
        config.get_settings.cache_clear()
