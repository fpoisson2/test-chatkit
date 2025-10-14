from __future__ import annotations

from types import TracebackType
from typing import Any

import pytest

from backend.app.chatkit_realtime import create_realtime_voice_session


@pytest.mark.asyncio
async def test_create_realtime_voice_session_uses_realtime_type(monkeypatch) -> None:
    """Vérifie que la requête inclut bien le type de session attendu."""

    class _DummySettings:
        openai_api_key = "sk-test"
        chatkit_api_base = "https://api.openai.com"

    class _DummyResponse:
        status_code = 200

        @staticmethod
        def json() -> dict[str, Any]:
            return {"client_secret": {"value": "secret"}}

    captured: dict[str, Any] = {}

    async def _post(self, path: str, *, json: dict[str, Any], headers: dict[str, str]):
        captured["path"] = path
        captured["payload"] = json
        captured["headers"] = headers
        return _DummyResponse()

    class _DummyAsyncClient:
        def __init__(self, **_: Any) -> None:
            pass

        async def __aenter__(self) -> "_DummyAsyncClient":
            return self

        async def __aexit__(
            self,
            exc_type: type[BaseException] | None,
            exc: BaseException | None,
            tb: TracebackType | None,
        ) -> None:
            return None

        post = _post

    monkeypatch.setattr(
        "backend.app.chatkit_realtime.get_settings", lambda: _DummySettings()
    )
    monkeypatch.setattr(
        "backend.app.chatkit_realtime.httpx.AsyncClient", _DummyAsyncClient
    )

    payload = await create_realtime_voice_session(
        user_id="user:123",
        model="gpt-realtime",
        instructions="Sois utile",
        voice="verse",
    )

    assert payload == {"client_secret": {"value": "secret"}}
    assert captured["path"] == "/v1/realtime/client_secrets"
    assert captured["payload"]["session"]["type"] == "realtime"
