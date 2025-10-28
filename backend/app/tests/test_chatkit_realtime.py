from __future__ import annotations

import asyncio
import os
import sys
from collections.abc import Callable
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

realtime_runner = import_module("backend.app.realtime_runner")
config_module = import_module("backend.app.config")
ModelProviderConfig = config_module.ModelProviderConfig


class _DummyResponse:
    def __init__(self, payload: dict[str, object], status_code: int = 200) -> None:
        self._payload = payload
        self.status_code = status_code

    def json(self) -> dict[str, object]:
        return self._payload


class _DummyAsyncClient:
    def __init__(
        self,
        *,
        captured: dict[str, object],
        response_factory: ResponseFactory | None = None,
        **_: object,
    ) -> None:
        self._captured = captured
        self._response_factory = response_factory
        self._call_count = 0

    async def __aenter__(self) -> _DummyAsyncClient:
        return self

    async def __aexit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    async def post(self, url: str, json: object, headers: dict[str, str]):
        request_data = {"url": url, "json": json, "headers": headers}
        self._captured.setdefault("requests", []).append(request_data)
        self._call_count += 1
        if self._response_factory is not None:
            return self._response_factory(request_data, self._call_count)
        return _DummyResponse({"client_secret": {"value": "secret"}})


ResponseFactory = Callable[[dict[str, object], int], _DummyResponse]


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


def _reset_orchestrator(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        realtime_runner,
        "_ORCHESTRATOR",
        realtime_runner.RealtimeVoiceSessionOrchestrator(),
    )


def test_open_voice_session_prefers_openai_slug(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            voice="verse",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    assert isinstance(handle.session_id, str) and handle.session_id
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    request = requests[0]
    assert request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    payload = request["json"]
    assert isinstance(payload, dict)
    assert payload.get("voice") == "verse"
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)
    assert "voice" not in session_payload
    headers = request["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_openai_slug_ignores_mismatched_provider_id(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: SimpleNamespace(
            id=provider_id,
            provider="groq",
            api_base="https://api.groq.com/openai/v1",
            api_key="groq-alt",
        ),
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-1",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_id="groq-default",
            provider_slug="openai",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    request = requests[0]
    assert request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    headers = request["headers"]
    assert isinstance(headers, dict)
    assert headers.get("Authorization") == "Bearer openai-key"


def test_voice_parameter_fallback_to_session(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'voice'.",
                        "type": "invalid_request_error",
                        "param": "voice",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-voice",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            voice="alloy",
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 2

    first_request = requests[0]
    assert first_request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    first_payload = first_request["json"]
    assert isinstance(first_payload, dict)
    assert first_payload.get("voice") == "alloy"
    session_payload = first_payload.get("session")
    assert isinstance(session_payload, dict)
    assert "voice" not in session_payload

    second_request = requests[1]
    assert second_request["url"] == "https://api.openai.com/v1/realtime/client_secrets"
    second_payload = second_request["json"]
    assert isinstance(second_payload, dict)
    assert "voice" not in second_payload
    session_payload = second_payload.get("session")
    assert isinstance(session_payload, dict)
    assert session_payload.get("voice") == "alloy"


def test_realtime_parameter_top_level_default(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )
    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(captured=captured, **kwargs),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime={"latency": "low"},
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 1
    first_request = requests[0]
    payload = first_request["json"]
    assert isinstance(payload, dict)
    assert payload.get("realtime") == {"latency": "low"}
    session_payload = payload.get("session")
    assert isinstance(session_payload, dict)
    assert "realtime" not in session_payload


def test_realtime_parameter_fallback_to_session(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'realtime'.",
                        "type": "invalid_request_error",
                        "param": "realtime",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime={"latency": "low"},
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 2

    first_payload = requests[0]["json"]
    assert isinstance(first_payload, dict)
    assert first_payload.get("realtime") == {"latency": "low"}
    first_session_payload = first_payload.get("session")
    assert isinstance(first_session_payload, dict)
    assert "realtime" not in first_session_payload

    second_payload = requests[1]["json"]
    assert isinstance(second_payload, dict)
    assert "realtime" not in second_payload
    second_session_payload = second_payload.get("session")
    assert isinstance(second_session_payload, dict)
    assert second_session_payload.get("realtime") == {"latency": "low"}


def test_realtime_parameter_fallback_to_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("CHATKIT_API_BASE", raising=False)
    captured: dict[str, object] = {}

    _reset_orchestrator(monkeypatch)
    monkeypatch.setattr(realtime_runner, "get_settings", lambda: _FakeSettings())
    monkeypatch.setattr(
        realtime_runner,
        "resolve_model_provider_credentials",
        lambda provider_id: None,
    )

    def _response_factory(
        request: dict[str, object], call_count: int
    ) -> _DummyResponse:
        if call_count == 1:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'realtime'.",
                        "type": "invalid_request_error",
                        "param": "realtime",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        if call_count == 2:
            return _DummyResponse(
                {
                    "error": {
                        "message": "Unknown parameter: 'session.realtime'.",
                        "type": "invalid_request_error",
                        "param": "session.realtime",
                        "code": "unknown_parameter",
                    }
                },
                status_code=400,
            )
        return _DummyResponse({"client_secret": {"value": "secret"}})

    monkeypatch.setattr(
        realtime_runner.httpx,
        "AsyncClient",
        lambda **kwargs: _DummyAsyncClient(
            captured=captured, response_factory=_response_factory, **kwargs
        ),
    )

    handle = asyncio.run(
        realtime_runner.open_voice_session(
            user_id="user-realtime",
            model="gpt-realtime",
            instructions="Bonjour",
            provider_slug="openai",
            realtime={"latency": "low"},
        )
    )

    assert handle.payload == {"client_secret": {"value": "secret"}}
    requests = captured.get("requests")
    assert isinstance(requests, list)
    assert len(requests) == 3

    first_payload = requests[0]["json"]
    assert isinstance(first_payload, dict)
    assert first_payload.get("realtime") == {"latency": "low"}

    second_payload = requests[1]["json"]
    assert isinstance(second_payload, dict)
    assert "realtime" not in second_payload
    second_session_payload = second_payload.get("session")
    assert isinstance(second_session_payload, dict)
    assert second_session_payload.get("realtime") == {"latency": "low"}

    third_payload = requests[2]["json"]
    assert isinstance(third_payload, dict)
    assert "realtime" not in third_payload
    third_session_payload = third_payload.get("session")
    assert isinstance(third_session_payload, dict)
    assert "realtime" not in third_session_payload
