from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import sys
from datetime import datetime
from importlib import import_module
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException, status
from fastapi.responses import FileResponse
from starlette.datastructures import UploadFile

if (
    importlib.util.find_spec("fastapi") is None
):  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from chatkit.store import NotFoundError  # noqa: E402
from chatkit.types import (  # noqa: E402
    InferenceOptions,
    ThreadCreateParams,
    ThreadsCreateReq,
    UserMessageInput,
    UserMessageTextContent,
)

routes_chatkit = import_module("backend.app.routes.chatkit")


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
        if (scheme == "http" and port not in (80, 0)) or (
            scheme == "https" and port not in (443, 0)
        ):
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
            headers=[
                ("x-forwarded-host", "public.example"),
                ("x-forwarded-proto", "https"),
            ],
        )

        response = await routes_chatkit.chatkit_endpoint(
            request, current_user=_StubUser()
        )

        assert response.media_type == "application/json"
        context = captured.get("context")
        assert context is not None
        assert context.public_base_url == "https://public.example"

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
            headers=[
                ("x-forwarded-host", "public.example"),
                ("x-forwarded-proto", "https"),
            ],
        )

        await routes_chatkit.chatkit_endpoint(request, current_user=_StubUser())

        context = captured.get("context")
        assert context is not None
        assert context.public_base_url == "https://configured.example"

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
        assert context.public_base_url == "http://backend.internal:9000"

    asyncio.run(_run())


def test_chatkit_endpoint_handles_import_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        def _raise_import_error():
            raise ImportError(
                "cannot import name 'AttachmentCreateParams' from 'chatkit.types'"
            )

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


def test_demo_server_handles_attachment_creation(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def _run() -> None:
        app_chatkit = import_module("backend.app.chatkit")
        server_module = import_module("backend.app.chatkit_server.server")
        from backend.app.chatkit_server.context import ChatKitRequestContext

        saved: dict[str, Any] = {}

        class _InMemoryStore:
            def __init__(
                self,
                _session_factory: Any,
                workflow_service: Any | None = None,
            ) -> None:
                self._attachments: dict[str, Any] = {}
                self._workflow_service = workflow_service

            async def save_attachment(self, attachment, context):  # type: ignore[no-untyped-def]
                saved["last_attachment"] = attachment
                saved["last_context"] = context
                self._attachments[attachment.id] = attachment

            async def load_attachment(self, attachment_id, context):  # type: ignore[no-untyped-def]
                try:
                    return self._attachments[attachment_id]
                except KeyError as exc:  # pragma: no cover - lecture inattendue
                    raise NotFoundError(
                        f"Attachment {attachment_id} introuvable"
                    ) from exc

            async def delete_attachment(self, attachment_id, context):  # type: ignore[no-untyped-def]
                self._attachments.pop(attachment_id, None)

        class _StubWorkflowService:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                pass

            def get_current(self, *args: Any, **kwargs: Any) -> Any:
                return SimpleNamespace(
                    workflow=None,
                    workflow_id=None,
                    workflow_display_name=None,
                    id="wf-def-1",
                    version=1,
                    updated_at=datetime.now(datetime.UTC),
                )

        monkeypatch.setattr(server_module, "PostgresChatKitStore", _InMemoryStore)
        monkeypatch.setattr(server_module, "WorkflowService", _StubWorkflowService)
        monkeypatch.setattr(
            server_module, "_get_thread_title_agent", lambda: SimpleNamespace()
        )
        monkeypatch.setattr(
            server_module, "_get_run_workflow", lambda: (lambda *a, **k: None)
        )
        monkeypatch.setattr(app_chatkit, "_server", None)

        server = app_chatkit.get_chatkit_server()

        assert isinstance(server.attachment_store, server_module.LocalAttachmentStore)

        context = ChatKitRequestContext(
            user_id="user-123",
            email="demo@example.com",
            authorization=None,
            public_base_url="https://public.test",
        )

        payload = json.dumps(
            {
                "type": "attachments.create",
                "params": {
                    "name": "demo.txt",
                    "size": 16,
                    "mime_type": "text/plain",
                },
            }
        )

        result = await server.process(payload, context)
        response = json.loads(result.json)

        assert response["name"] == "demo.txt"
        assert response["mime_type"] == "text/plain"
        assert response["upload_url"].startswith(
            "https://public.test/api/chatkit/attachments/"
        )
        assert saved["last_context"] == context
        assert saved["last_attachment"].name == "demo.txt"

    asyncio.run(_run())


def test_demo_server_injects_workflow_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        app_chatkit = import_module("backend.app.chatkit")
        server_module = import_module("backend.app.chatkit_server.server")
        from backend.app.chatkit_server.context import ChatKitRequestContext

        captured: dict[str, Any] = {}

        class _StubStore:
            def __init__(
                self,
                _session_factory: Any,
                workflow_service: Any | None = None,
            ) -> None:
                captured["store"] = self
                self._workflow_service = workflow_service
                self.saved_threads: list[Any] = []

            def generate_thread_id(self, context):  # type: ignore[no-untyped-def]
                return "thread-generated"

            async def save_thread(self, thread, context):  # type: ignore[no-untyped-def]
                self.saved_threads.append(thread)

        class _StubWorkflowService:
            def __init__(self, *args: Any, **kwargs: Any) -> None:
                self.calls = 0

            def get_current(self, *args: Any, **kwargs: Any) -> Any:
                self.calls += 1
                workflow = SimpleNamespace(id=42, slug="active-workflow")
                return SimpleNamespace(id=84, workflow=workflow)

        async def _noop_user_message(self, *args: Any, **kwargs: Any) -> Any:
            return SimpleNamespace(id="message-1")

        async def _empty_stream(self, *args: Any, **kwargs: Any):  # type: ignore[no-untyped-def]
            if False:  # pragma: no cover - garde pour générateur async
                yield None
            return

        monkeypatch.setattr(server_module, "PostgresChatKitStore", _StubStore)
        monkeypatch.setattr(server_module, "WorkflowService", _StubWorkflowService)
        monkeypatch.setattr(
            server_module, "_get_thread_title_agent", lambda: SimpleNamespace()
        )
        monkeypatch.setattr(
            server_module, "_get_run_workflow", lambda: (lambda *a, **k: None)
        )
        monkeypatch.setattr(app_chatkit, "_server", None, raising=False)

        monkeypatch.setattr(
            server_module.DemoChatKitServer,
            "_build_user_message_item",
            _noop_user_message,
        )
        monkeypatch.setattr(
            server_module.DemoChatKitServer,
            "_process_new_thread_item_respond",
            _empty_stream,
        )

        server = app_chatkit.get_chatkit_server()

        request = ThreadsCreateReq(
            params=ThreadCreateParams(
                input=UserMessageInput(
                    content=[UserMessageTextContent(text="Bonjour")],
                    attachments=[],
                    inference_options=InferenceOptions(),
                )
            )
        )

        context = ChatKitRequestContext(
            user_id="user-1",
            email="demo@example.com",
            authorization=None,
            public_base_url="https://public.example",
        )

        events = []
        async for event in server._process_streaming_impl(request, context):
            events.append(event)

        store = captured["store"]
        saved_threads = store.saved_threads
        assert len(saved_threads) == 1
        workflow_metadata = saved_threads[0].metadata.get("workflow")
        assert workflow_metadata == {
            "id": 42,
            "slug": "active-workflow",
            "definition_id": 84,
        }

        workflow_service = server._workflow_service
        assert workflow_service.calls >= 1

        assert events and events[0].type == "thread.created"

    asyncio.run(_run())
