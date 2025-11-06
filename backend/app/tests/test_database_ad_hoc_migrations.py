import json
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

try:  # pragma: no cover - environnement réduit
    from fastapi import FastAPI
except ModuleNotFoundError:  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("APP_SETTINGS_SECRET_KEY", "tests-secret-key")
os.environ.setdefault("AUTH_SECRET_KEY", "tests-auth-key")

from backend.app import startup  # noqa: E402
from backend.app.database import ad_hoc_migrations as migrations  # noqa: E402


class FakeResult:
    def __init__(self, rows: list[tuple[int, str, dict]]):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class FakeSession:
    def __init__(self, rows: list[tuple[int, str, dict]]):
        self._rows = rows
        self.update_params: list[dict[str, str]] = []
        self.commit_called = False

    def execute(self, statement, params=None):
        sql = getattr(statement, "text", str(statement))
        if "SELECT ws.id" in sql:
            return FakeResult(self._rows)
        if "UPDATE workflow_steps" in sql:
            if params is not None:
                self.update_params.append(params)
            return FakeResult([])
        return FakeResult([])

    def commit(self) -> None:
        self.commit_called = True

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb) -> None:  # noqa: D401 - signature per context manager
        return None


def test_run_ad_hoc_migrations_invokes_helpers(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[str] = []

    monkeypatch.setattr(
        migrations, "_run_ad_hoc_migrations", lambda: calls.append("run")
    )
    monkeypatch.setattr(
        migrations, "_cleanup_duplicate_mcp_servers", lambda: calls.append("cleanup")
    )

    migrations.run_ad_hoc_migrations()

    assert calls == ["run", "cleanup"]


def test_cleanup_duplicate_mcp_servers_deduplicates(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tools = [
        {"type": "mcp", "server_url": "https://example.com", "allow": ["read"]},
        {"type": "mcp", "server_url": "https://example.com"},
        {"type": "mcp", "server_url": "https://example.com/other"},
        {"type": "retrieval"},
    ]
    rows = [(1, "step-one", {"tools": tools})]
    fake_session = FakeSession(rows)

    monkeypatch.setattr(migrations, "SessionLocal", lambda: fake_session)

    migrations._cleanup_duplicate_mcp_servers()

    assert fake_session.commit_called is True
    assert len(fake_session.update_params) == 1

    payload = json.loads(fake_session.update_params[0]["params"])
    assert payload["tools"] == [
        {"type": "mcp", "server_url": "https://example.com", "allow": ["read"]},
        {"type": "mcp", "server_url": "https://example.com/other"},
        {"type": "retrieval"},
    ]


def test_configure_sip_layer_uses_invite_factory(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[object] = []

    monkeypatch.setattr(startup, "USE_PJSUA", False)

    settings_stub = SimpleNamespace(
        sip_contact_host="example.com",
        sip_contact_port=5062,
        sip_bind_port=5060,
        sip_contact_transport="udp",
        sip_bind_host="0.0.0.0",
    )
    monkeypatch.setattr(startup, "settings", settings_stub)

    class DummyManager:
        def __init__(self, *args, **kwargs):
            self.kwargs = kwargs
            self.invite_handler = None

        def set_invite_handler(self, handler: object) -> None:
            self.invite_handler = handler

    monkeypatch.setattr(startup, "MultiSIPRegistrationManager", DummyManager)

    sentinel_handler = object()

    def fake_factory(manager: DummyManager) -> object:
        calls.append(manager)
        return sentinel_handler

    app = FastAPI()

    host, port = startup.configure_sip_layer(
        app, invite_handler_factory=fake_factory
    )

    assert host == "example.com"
    assert port == 5062
    assert isinstance(app.state.sip_registration, DummyManager)
    assert calls == [app.state.sip_registration]
    assert app.state.sip_registration.invite_handler is sentinel_handler
    assert app.state.pjsua_adapter is None


def test_register_startup_events_uses_ad_hoc_migrations(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []

    monkeypatch.setattr(startup, "USE_PJSUA", True)

    class DummyPJSUAAdapter:
        def __init__(self):
            pass

    monkeypatch.setattr(startup, "PJSUAAdapter", DummyPJSUAAdapter)
    monkeypatch.setattr(startup, "wait_for_database", lambda: calls.append("wait"))
    monkeypatch.setattr(startup, "ensure_database_extensions", lambda: None)
    monkeypatch.setattr(startup, "ensure_vector_indexes", lambda: None)
    monkeypatch.setattr(
        startup, "run_ad_hoc_migrations", lambda: calls.append("ad-hoc")
    )
    monkeypatch.setattr(startup.Base.metadata, "create_all", lambda **kwargs: None)
    monkeypatch.setattr(startup, "configure_model_provider", lambda settings: None)
    monkeypatch.setattr(startup, "_ensure_protected_vector_store", lambda: None)
    monkeypatch.setattr(
        startup, "get_thread_title_prompt_override", lambda session: None
    )
    monkeypatch.setattr(
        startup, "apply_runtime_model_overrides", lambda override: object()
    )

    class DummySession:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, tb):
            return None

        def scalar(self, *args, **kwargs):
            return None

        def add(self, obj):
            return None

        def commit(self):
            return None

    monkeypatch.setattr(startup, "SessionLocal", lambda: DummySession())

    settings_stub = SimpleNamespace(
        sip_contact_host="localhost",
        sip_contact_port=5060,
        sip_bind_port=5060,
        sip_contact_transport="udp",
        sip_bind_host="0.0.0.0",
        admin_email=None,
        admin_password=None,
        docs_seed_documents=[],
    )
    monkeypatch.setattr(startup, "settings", settings_stub)

    app = FastAPI()
    startup.register_startup_events(app)

    for handler in app.router.on_startup:
        handler()

    assert calls.count("ad-hoc") == 1
