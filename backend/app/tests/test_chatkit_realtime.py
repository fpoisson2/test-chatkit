import asyncio
import os
import sys
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

import pytest

os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

chatkit_realtime = import_module("backend.app.chatkit_realtime")
config_module = import_module("backend.app.config")
ModelProviderConfig = config_module.ModelProviderConfig


class _DummyResponse:
    status_code = 200

    def __init__(self, payload: dict[str, object]) -> None:
        self._payload = payload

    def json(self) -> dict[str, object]:
        return self._payload


class _DummyAsyncClient:
    def __init__(self, *, captured: dict[str, object], **_: object) -> None:
        self._captured = captured

    async def __aenter__(self) -> "_DummyAsyncClient":
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    async def post(self, url: str, json: object, headers: dict[str, str]):
        self._captured["url"] = url
        self._captured["json"] = json
        self._captured["headers"] = headers
        return _DummyResponse({"client_secret": {"value": "secret"}})


class _FakeSettings:
    model_api_base = "https://api.groq.com/openai/v1"
    model_api_key = "groq-key"
    model_provider = "groq"
    model_providers = (
        ModelProviderConfig(
            provider="groq",
            api_base="https://api.groq.com/openai/v1",
            api_key="groq-key",
            is_default=True,
            id="groq-default",
        ),
    )
    openai_api_key = "openai-key"


def test_create_realtime_voice_session_prefers_openai_slug(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    monkeypatch.setattr(chatkit_realtime, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        chatkit_realtime,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        chatkit_realtime.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    response = asyncio.run(
        chatkit_realtime.create_realtime_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
        )
    )

    assert response == {"client_secret": {"value": "secret"}}
    assert captured["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_openai_slug_ignores_mismatched_provider_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    monkeypatch.setattr(chatkit_realtime, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        chatkit_realtime,
        "resolve_model_provider_credentials",
        lambda provider_id: SimpleNamespace(
            id=provider_id,
            provider="groq",
            api_base="https://api.groq.com/openai/v1",
            api_key="groq-alt",
        ),
    )
    monkeypatch.setattr(
        chatkit_realtime.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    response = asyncio.run(
        chatkit_realtime.create_realtime_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_id="groq-default",
            provider_slug="openai",
        )
    )

    assert response == {"client_secret": {"value": "secret"}}
    assert captured["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    headers = captured["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"
