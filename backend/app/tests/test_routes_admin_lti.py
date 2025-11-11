import os
import sys
from collections.abc import Iterator
from pathlib import Path
from types import SimpleNamespace

import pytest

try:  # pragma: no cover - environnement réduit
    from fastapi import FastAPI, status  # noqa: E402
    from fastapi.testclient import TestClient  # noqa: E402
except ModuleNotFoundError:  # pragma: no cover - environnement réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

try:  # pragma: no cover - environnement réduit
    from sqlalchemy import create_engine, select  # noqa: E402
    from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
except ModuleNotFoundError:  # pragma: no cover - environnement réduit
    pytest.skip("sqlalchemy non disponible", allow_module_level=True)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("APP_SETTINGS_SECRET_KEY", "admin-lti-secret")
os.environ.setdefault("AUTH_SECRET_KEY", "auth-secret")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("DATABASE_URL", "sqlite:///./admin-lti-test.db")
os.environ.setdefault("LTI_TOOL_CLIENT_ID", "env-client")
os.environ.setdefault("LTI_TOOL_KEY_SET_URL", "https://env.example/jwks")
os.environ.setdefault("LTI_TOOL_AUDIENCE", "https://env.example")
os.environ.setdefault("LTI_TOOL_KEY_ID", "env-key")
os.environ.setdefault("LTI_TOOL_PRIVATE_KEY", "")

from backend.app.config import (  # noqa: E402
    get_settings,
    set_runtime_settings_overrides,
)
from backend.app.database import get_session  # noqa: E402
from backend.app.dependencies import require_admin  # noqa: E402
from backend.app.models import AppSettings, Base, LTIRegistration  # noqa: E402
from backend.app.routes import admin as admin_routes  # noqa: E402


@pytest.fixture(autouse=True)
def _reset_settings():
    get_settings.cache_clear()
    set_runtime_settings_overrides(None)
    yield
    set_runtime_settings_overrides(None)
    get_settings.cache_clear()


@pytest.fixture()
def session_factory() -> Iterator[sessionmaker[Session]]:
    engine = create_engine(
        "sqlite+pysqlite:///:memory:", connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)
    yield SessionFactory
    engine.dispose()


@pytest.fixture()
def client(session_factory: sessionmaker[Session]) -> Iterator[TestClient]:
    app = FastAPI()
    app.include_router(admin_routes.router)

    def _get_session_override():  # type: ignore[no-untyped-def]
        session = session_factory()
        try:
            yield session
        finally:
            session.close()

    async def _require_admin_override() -> SimpleNamespace:
        return SimpleNamespace(id=1, is_admin=True)

    app.dependency_overrides[get_session] = _get_session_override
    app.dependency_overrides[require_admin] = _require_admin_override

    with TestClient(app) as test_client:
        yield test_client


def test_lti_tool_settings_get_and_update(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    response = client.get("/api/admin/lti/tool-settings")
    assert response.status_code == status.HTTP_200_OK
    payload = response.json()
    assert payload["client_id"] == "env-client"
    assert payload["key_set_url"] == "https://env.example/jwks"
    assert payload["has_private_key"] is False

    update_response = client.patch(
        "/api/admin/lti/tool-settings",
        json={
            "client_id": "tool-client",
            "key_set_url": "https://tool.example/jwks.json",
            "audience": "https://platform.example",
            "key_id": "tool-key",
            "private_key": "-----BEGIN KEY-----\nsecret-1234\n-----END KEY-----",
        },
    )
    assert update_response.status_code == status.HTTP_200_OK
    updated = update_response.json()
    assert updated["client_id"] == "tool-client"
    assert updated["key_set_url"] == "https://tool.example/jwks.json"
    assert updated["audience"] == "https://platform.example"
    assert updated["key_id"] == "tool-key"
    assert updated["has_private_key"] is True
    assert updated["is_private_key_overridden"] is True
    assert updated["private_key_hint"]

    SessionFactory = session_factory
    with SessionFactory() as session:
        settings = session.scalar(select(AppSettings).limit(1))
        assert settings is not None
        assert settings.lti_tool_client_id == "tool-client"
        assert settings.lti_tool_key_id == "tool-key"
        assert settings.lti_tool_key_set_url == "https://tool.example/jwks.json"
        assert settings.lti_tool_audience == "https://platform.example"
        assert settings.lti_tool_private_key_encrypted is not None

    runtime = get_settings()
    assert runtime.lti_tool_client_id == "tool-client"
    assert runtime.lti_tool_key_id == "tool-key"
    assert runtime.lti_tool_key_set_url == "https://tool.example/jwks.json"


def test_lti_registration_crud_flow(
    client: TestClient, session_factory: sessionmaker[Session]
) -> None:
    create_payload = {
        "issuer": "https://platform.example",
        "client_id": "platform-client",
        "key_set_url": "https://platform.example/jwks",
        "authorization_endpoint": "https://platform.example/oidc",
        "token_endpoint": "https://platform.example/token",
        "deep_link_return_url": "https://platform.example/deep-link",
        "audience": "https://platform.example",
    }

    create_response = client.post(
        "/api/admin/lti/registrations",
        json=create_payload,
    )
    assert create_response.status_code == status.HTTP_201_CREATED
    created = create_response.json()
    registration_id = created["id"]

    list_response = client.get("/api/admin/lti/registrations")
    assert list_response.status_code == status.HTTP_200_OK
    listed = list_response.json()
    assert len(listed) == 1
    assert listed[0]["issuer"] == "https://platform.example"

    update_response = client.patch(
        f"/api/admin/lti/registrations/{registration_id}",
        json={
            "issuer": "https://platform-alt.example",
            "audience": "https://audience.example",
        },
    )
    assert update_response.status_code == status.HTTP_200_OK
    updated = update_response.json()
    assert updated["issuer"] == "https://platform-alt.example"
    assert updated["audience"] == "https://audience.example"

    duplicate_response = client.post(
        "/api/admin/lti/registrations",
        json={**create_payload, "issuer": "https://platform-alt.example"},
    )
    assert duplicate_response.status_code == status.HTTP_400_BAD_REQUEST

    delete_response = client.delete(
        f"/api/admin/lti/registrations/{registration_id}"
    )
    assert delete_response.status_code == status.HTTP_204_NO_CONTENT

    with session_factory() as session:
        remaining = session.scalars(select(LTIRegistration)).all()
        assert remaining == []
