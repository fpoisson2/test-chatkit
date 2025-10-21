from __future__ import annotations

import importlib.util
import sys
import asyncio
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, status
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile

if importlib.util.find_spec("fastapi") is None:  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from backend.app.routes import chatkit as routes_chatkit


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


def test_chatkit_endpoint_uses_forwarded_headers_when_env_not_overridden(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
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

        response = await routes_chatkit.chatkit_endpoint(
            request, current_user=_StubUser()
        )

        assert response.media_type == "application/json"
        context = captured.get("context")
        assert context is not None
        assert getattr(context, "public_base_url") == "https://public.example"

    asyncio.run(_run())


def test_chatkit_endpoint_prefers_configured_public_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
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

    asyncio.run(_run())


def test_chatkit_endpoint_falls_back_to_request_base_url(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
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

    asyncio.run(_run())


def test_chatkit_endpoint_handles_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        def _raise_import_error():
            raise ImportError("cannot import name 'AttachmentCreateParams' from 'chatkit.types'")

        monkeypatch.setattr(routes_chatkit, "get_chatkit_server", _raise_import_error)

        request = _build_request()

        with pytest.raises(HTTPException) as excinfo:
            await routes_chatkit.chatkit_endpoint(request, current_user=_StubUser())

        assert excinfo.value.status_code == status.HTTP_500_INTERNAL_SERVER_ERROR
        detail = excinfo.value.detail
        assert isinstance(detail, dict)
        assert detail.get("error") == "Import du SDK ChatKit impossible"
        assert "AttachmentCreateParams" in str(detail.get("details"))

    asyncio.run(_run())


def test_upload_attachment_invokes_store(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        calls: dict[str, Any] = {}

        class _StubStore:
            async def finalize_upload(self, attachment_id, upload, context):  # type: ignore[no-untyped-def]
                calls["attachment_id"] = attachment_id
                calls["user_id"] = context.user_id
                calls["payload"] = await upload.read()

        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            lambda: SimpleNamespace(attachment_store=_StubStore()),
        )

        upload = UploadFile(filename="demo.txt", file=BytesIO(b"payload"))

        result = await routes_chatkit.upload_chatkit_attachment(
            "att-1",
            _build_request(),
            upload,
            current_user=_StubUser(),
        )

        assert result == {"id": "att-1"}
        assert calls == {
            "attachment_id": "att-1",
            "user_id": "user-1",
            "payload": b"payload",
        }

    asyncio.run(_run())


def test_upload_attachment_requires_configured_store(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            lambda: SimpleNamespace(attachment_store=None),
        )

        upload = UploadFile(filename="demo.txt", file=BytesIO(b"ignored"))

        with pytest.raises(HTTPException) as excinfo:
            await routes_chatkit.upload_chatkit_attachment(
                "att-1",
                _build_request(),
                upload,
                current_user=_StubUser(),
            )

        assert excinfo.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

    asyncio.run(_run())


def test_upload_attachment_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        def _raise_import_error():
            raise ImportError("incompatible chatkit package")

        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            _raise_import_error,
        )

        upload = UploadFile(filename="demo.txt", file=BytesIO(b"ignored"))

        with pytest.raises(HTTPException) as excinfo:
            await routes_chatkit.upload_chatkit_attachment(
                "att-err",
                _build_request(),
                upload,
                current_user=_StubUser(),
            )

        assert excinfo.value.status_code == status.HTTP_503_SERVICE_UNAVAILABLE

    asyncio.run(_run())


def test_download_attachment_returns_file_response(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    async def _run() -> None:
        file_path = tmp_path / "stored.txt"
        file_path.write_text("ok")

        class _StubStore:
            async def open_attachment(self, attachment_id, context):  # type: ignore[no-untyped-def]
                return file_path, "text/plain", "stored.txt"

        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            lambda: SimpleNamespace(attachment_store=_StubStore()),
        )

        response = await routes_chatkit.download_chatkit_attachment(
            "att-9",
            _build_request(),
            current_user=_StubUser(),
        )

        assert isinstance(response, FileResponse)
        assert Path(response.path) == file_path
        assert response.media_type == "text/plain"

    asyncio.run(_run())


def test_download_attachment_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        def _raise_import_error():
            raise ImportError("incompatible chatkit package")

        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            _raise_import_error,
        )

        with pytest.raises(HTTPException) as excinfo:
            await routes_chatkit.download_chatkit_attachment(
                "att-err",
                _build_request(),
                current_user=_StubUser(),
            )

        assert excinfo.value.status_code == status.HTTP_404_NOT_FOUND

    asyncio.run(_run())


def test_download_attachment_missing_store(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        monkeypatch.setattr(
            routes_chatkit,
            "get_chatkit_server",
            lambda: SimpleNamespace(attachment_store=None),
        )

        with pytest.raises(HTTPException) as excinfo:
            await routes_chatkit.download_chatkit_attachment(
                "att-404",
                _build_request(),
                current_user=_StubUser(),
            )

        assert excinfo.value.status_code == status.HTTP_404_NOT_FOUND

    asyncio.run(_run())
