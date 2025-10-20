from __future__ import annotations

import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest

if importlib.util.find_spec("fastapi") is None:  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

MODULE_PATH = Path(__file__).resolve().parents[1] / "routes" / "chatkit.py"
spec = importlib.util.spec_from_file_location("routes_chatkit", MODULE_PATH)
routes_chatkit = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(routes_chatkit)


class _StubUser:
    id = "user-1"
    email = "user@example.com"


class _HeaderMapping(dict):
    def get(self, key: str, default=None):  # type: ignore[override]
        return super().get(key.lower(), default)


class _BaseURL:
    def __init__(self, value: str) -> None:
        self._value = value

    def __str__(self) -> str:
        return self._value


class _StubRequest:
    def __init__(
        self,
        *,
        scheme: str = "http",
        host: str = "backend.local",
        port: int = 80,
        headers: list[tuple[str, str]] | None = None,
        body: bytes = b"{}",
    ) -> None:
        self._scheme = scheme
        self._body = body
        normalized = _HeaderMapping()
        default_host = host
        if (scheme == "http" and port != 80) or (scheme == "https" and port != 443):
            default_host = f"{host}:{port}"
        normalized["host"] = default_host
        if headers:
            for key, value in headers:
                normalized[key.lower()] = value
        self.headers = normalized
        base = f"{scheme}://{host}"
        if (scheme == "http" and port not in (80, 0)) or (scheme == "https" and port not in (443, 0)):
            base = f"{base}:{port}"
        self._base_url = _BaseURL(base)

    async def body(self) -> bytes:
        return self._body

    @property
    def base_url(self) -> _BaseURL:
        return self._base_url

    @property
    def url(self) -> SimpleNamespace:
        return SimpleNamespace(scheme=self._scheme)


def _build_request(**kwargs) -> _StubRequest:
    return _StubRequest(**kwargs)


@pytest.mark.asyncio
async def test_chatkit_endpoint_uses_forwarded_headers_when_env_not_overridden(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _StubServer:
        async def process(self, payload: bytes, context) -> SimpleNamespace:
            captured["context"] = context
            return SimpleNamespace(json="{}")

    monkeypatch.setattr(routes_chatkit, "get_chatkit_server", lambda: _StubServer())
    monkeypatch.setattr(
        routes_chatkit,
        "get_settings",
        lambda: SimpleNamespace(
            backend_public_base_url="http://localhost:8000",
            backend_public_base_url_from_env=False,
        ),
    )

    request = _build_request(
        headers=[("x-forwarded-host", "public.example"), ("x-forwarded-proto", "https")],
    )

    response = await routes_chatkit.chatkit_endpoint(request, current_user=_StubUser())

    assert response.media_type == "application/json"
    context = captured.get("context")
    assert context is not None
    assert getattr(context, "public_base_url") == "https://public.example"


@pytest.mark.asyncio
async def test_chatkit_endpoint_prefers_configured_public_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _StubServer:
        async def process(self, payload: bytes, context) -> SimpleNamespace:
            captured["context"] = context
            return SimpleNamespace(json="{}")

    monkeypatch.setattr(routes_chatkit, "get_chatkit_server", lambda: _StubServer())
    monkeypatch.setattr(
        routes_chatkit,
        "get_settings",
        lambda: SimpleNamespace(
            backend_public_base_url="https://configured.example",
            backend_public_base_url_from_env=True,
        ),
    )

    request = _build_request(
        headers=[("x-forwarded-host", "public.example"), ("x-forwarded-proto", "https")],
    )

    await routes_chatkit.chatkit_endpoint(request, current_user=_StubUser())

    context = captured.get("context")
    assert context is not None
    assert getattr(context, "public_base_url") == "https://configured.example"


@pytest.mark.asyncio
async def test_chatkit_endpoint_falls_back_to_request_base_url(monkeypatch: pytest.MonkeyPatch) -> None:
    captured: dict[str, object] = {}

    class _StubServer:
        async def process(self, payload: bytes, context) -> SimpleNamespace:
            captured["context"] = context
            return SimpleNamespace(json="{}")

    monkeypatch.setattr(routes_chatkit, "get_chatkit_server", lambda: _StubServer())
    monkeypatch.setattr(
        routes_chatkit,
        "get_settings",
        lambda: SimpleNamespace(
            backend_public_base_url="http://localhost:8000",
            backend_public_base_url_from_env=False,
        ),
    )

    request = _build_request(scheme="http", host="backend.internal", port=9000)

    await routes_chatkit.chatkit_endpoint(request, current_user=_StubUser())

    context = captured.get("context")
    assert context is not None
    assert getattr(context, "public_base_url") == "http://backend.internal:9000"
