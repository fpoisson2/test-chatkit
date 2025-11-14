import base64
import datetime
import importlib
import os
import sys
from pathlib import Path
from urllib.parse import parse_qs, urlparse

import jwt
import pytest
import sqlalchemy
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from sqlalchemy import create_engine, select
from sqlalchemy.pool import StaticPool

_FASTAPI_SPEC = importlib.util.find_spec("fastapi")
if _FASTAPI_SPEC is None:  # pragma: no cover - env réduit
    pytest.skip(
        "fastapi non disponible",
        allow_module_level=True,
    )

_JWT_SPEC = importlib.util.find_spec("jwt")
if _JWT_SPEC is None:  # pragma: no cover - env réduit
    pytest.skip(
        "PyJWT non disponible",
        allow_module_level=True,
    )

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

def _generate_private_key() -> tuple[rsa.RSAPrivateKey, str]:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    ).decode()
    return key, pem


TOOL_KEY, TOOL_PRIVATE_KEY = _generate_private_key()
PLATFORM_KEY, PLATFORM_PRIVATE_KEY = _generate_private_key()


os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("AUTH_SECRET_KEY", "tests-auth-key")
os.environ.setdefault("OPENAI_API_KEY", "test-openai-key")
os.environ.setdefault("MODEL_PROVIDER", "openai")
os.environ.setdefault("CHATKIT_API_BASE", "https://api.example.com")
os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://tool.example")
os.environ.setdefault("LTI_TOOL_PRIVATE_KEY", TOOL_PRIVATE_KEY)
os.environ.setdefault(
    "LTI_TOOL_KEY_SET_URL", "https://tool.example/.well-known/jwks.json"
)
os.environ.setdefault("LTI_TOOL_CLIENT_ID", "tool-client")
os.environ.setdefault("LTI_TOOL_AUDIENCE", "platform-audience")
os.environ.setdefault("LTI_TOOL_KEY_ID", "tool-key")


@pytest.fixture(autouse=True)
def _ensure_settings(monkeypatch: pytest.MonkeyPatch):
    from backend.app.config import get_settings, set_runtime_settings_overrides

    get_settings.cache_clear()
    set_runtime_settings_overrides(None)
    yield
    set_runtime_settings_overrides(None)
    get_settings.cache_clear()


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch):
    config = importlib.reload(importlib.import_module("backend.app.config"))
    config.get_settings.cache_clear()
    config.set_runtime_settings_overrides(
        {
            "backend_public_base_url": "https://tool.example",
            "lti_tool_private_key": TOOL_PRIVATE_KEY,
            "lti_tool_key_set_url": "https://tool.example/.well-known/jwks.json",
            "lti_tool_client_id": "tool-client",
            "lti_tool_audience": "platform-audience",
            "lti_tool_key_id": "tool-key",
        }
    )

    database = importlib.reload(importlib.import_module("backend.app.database"))
    models = importlib.reload(importlib.import_module("backend.app.models"))
    importlib.reload(importlib.import_module("backend.app.security"))
    importlib.reload(importlib.import_module("backend.app.lti.service"))
    lti_routes = importlib.reload(importlib.import_module("backend.app.routes.lti"))

    settings = config.get_settings()
    database.engine.dispose()
    connect_args = {}
    engine_kwargs = {
        "future": True,
        "pool_pre_ping": True,
    }
    if settings.database_url.startswith("sqlite"):
        connect_args = {"check_same_thread": False}
        engine_kwargs["connect_args"] = connect_args
        if settings.database_url.endswith(":memory:"):
            engine_kwargs["poolclass"] = StaticPool

    database.engine = create_engine(
        settings.database_url,
        **engine_kwargs,
    )
    database.SessionLocal.configure(bind=database.engine)
    models.Base.metadata.drop_all(bind=database.engine, checkfirst=True)
    models.Base.metadata.create_all(bind=database.engine)
    inspector = sqlalchemy.inspect(database.engine)
    assert "workflow_transitions" in inspector.get_table_names()

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    app = FastAPI()
    app.include_router(lti_routes.router)

    with TestClient(app) as test_client:
        yield test_client


def _build_jwk(private_key: rsa.RSAPrivateKey, kid: str) -> dict[str, str]:
    numbers = private_key.public_key().public_numbers()
    return {
        "kty": "RSA",
        "alg": "RS256",
        "use": "sig",
        "kid": kid,
        "n": _b64(numbers.n),
        "e": _b64(numbers.e),
    }


def _b64(value: int) -> str:
    size = (value.bit_length() + 7) // 8
    return base64.urlsafe_b64encode(value.to_bytes(size, "big")).rstrip(b"=").decode()


def test_jwks_endpoint_returns_public_key(client):
    response = client.get("/.well-known/jwks.json")
    assert response.status_code == 200
    payload = response.json()
    assert payload["keys"] == [_build_jwk(TOOL_KEY, "tool-key")]


def _setup_registration(session):
    models = importlib.import_module("backend.app.models")

    workflow = models.Workflow(slug="demo-workflow", display_name="Workflow Demo")
    session.add(workflow)
    session.flush()

    registration = models.LTIRegistration(
        issuer="https://platform.example",
        client_id="platform-client",
        key_set_url="https://platform.example/jwks",
        authorization_endpoint="https://platform.example/oidc",
        token_endpoint="https://platform.example/token",
        deep_link_return_url="https://platform.example/deep-link",
        audience="platform-audience",
    )
    session.add(registration)
    session.flush()

    deployment = models.LTIDeployment(
        registration_id=registration.id,
        deployment_id="deployment-123",
        workflow_id=workflow.id,
    )
    session.add(deployment)
    session.commit()

    return registration, deployment, workflow


def _patch_platform_keys(monkeypatch: pytest.MonkeyPatch):
    service_module = importlib.import_module("backend.app.lti.service")

    jwks_payload = {"keys": [_build_jwk(PLATFORM_KEY, "platform-key")]}    

    class _Response:
        def __init__(self, payload):
            self._payload = payload

        def raise_for_status(self):
            return None

        def json(self):
            return self._payload

    monkeypatch.setattr(
        service_module.httpx,
        "get",
        lambda *_args, **_kwargs: _Response(jwks_payload),
    )


def _build_id_token(
    nonce: str, deployment_id: str, message_type: str, extra_claims=None
):
    now = datetime.datetime.utcnow()
    claims = {
        "iss": "https://platform.example",
        "aud": ["tool-client"],
        "sub": "user-123",
        "nonce": nonce,
        "iat": int(now.timestamp()),
        "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
        "https://purl.imsglobal.org/spec/lti/claim/message_type": message_type,
        "https://purl.imsglobal.org/spec/lti/claim/version": "1.3.0",
        "https://purl.imsglobal.org/spec/lti/claim/deployment_id": deployment_id,
    }
    if extra_claims:
        claims.update(extra_claims)
    return jwt.encode(
        claims,
        PLATFORM_PRIVATE_KEY,
        algorithm="RS256",
        headers={"kid": "platform-key"},
    )


def test_lti_launch_provisions_user_and_returns_token(client, monkeypatch):
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    _patch_platform_keys(monkeypatch)

    with database.SessionLocal() as session:
        _, _, workflow = _setup_registration(session)

    response = client.post(
        "/api/lti/login",
        data={
            "iss": "https://platform.example",
            "client_id": "platform-client",
            "lti_deployment_id": "deployment-123",
            "target_link_uri": "https://tool.example/api/lti/launch",
            "login_hint": "hint",
            "lti_message_hint": "resource-456",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302
    parsed = urlparse(response.headers["location"])
    state = parse_qs(parsed.query)["state"][0]

    with database.SessionLocal() as session:
        session_record = session.scalar(
            select(models.LTIUserSession).where(models.LTIUserSession.state == state)
        )
        assert session_record is not None
        nonce = session_record.nonce

    id_token = _build_id_token(
        nonce,
        "deployment-123",
        "LtiResourceLinkRequest",
        {
            "email": "student@example.com",
            "https://purl.imsglobal.org/spec/lti/claim/resource_link": {
                "id": "resource-456"
            },
            "https://purl.imsglobal.org/spec/lti/claim/custom": {
                "workflow_slug": "demo-workflow"
            },
            "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
                "lineitems": "https://platform.example/contexts/123/lineitems",
                "lineitem": "https://platform.example/contexts/123/lineitems/quiz",
                "scope": [
                    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
                    "https://purl.imsglobal.org/spec/lti-ags/scope/score",
                ],
            },
            "https://purl.imsglobal.org/spec/lti-ags/claim/lineitem": {
                "scoreMaximum": 20,
                "label": "Quiz final",
            },
        },
    )

    launch = client.post("/api/lti/launch", json={"state": state, "id_token": id_token})
    assert launch.status_code == 200
    payload = launch.json()
    assert payload["token_type"] == "bearer"
    assert payload["user"]["email"] == "student@example.com"

    decoded = jwt.decode(
        payload["access_token"],
        "tests-auth-key",
        algorithms=["HS256"],
    )
    assert decoded["email"] == "student@example.com"

    with database.SessionLocal() as session:
        user = session.scalar(
            select(models.User).where(models.User.email == "student@example.com")
        )
        assert user is not None
        resource_link = session.scalar(
            select(models.LTIResourceLink).where(
                models.LTIResourceLink.resource_link_id == "resource-456"
            )
        )
        assert resource_link is not None
        assert resource_link.workflow_id == workflow.id
        session_record = session.scalar(
            select(models.LTIUserSession).where(
                models.LTIUserSession.user_id == user.id
            )
        )
        assert session_record is not None
        assert session_record.platform_user_id == "user-123"
        assert (
            session_record.ags_line_items_endpoint
            == "https://platform.example/contexts/123/lineitems"
        )
        assert (
            session_record.ags_line_item_endpoint
            == "https://platform.example/contexts/123/lineitems/quiz"
        )
        assert session_record.ags_scopes == [
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        ]
        assert session_record.ags_line_item_claim == {
            "scoreMaximum": 20,
            "label": "Quiz final",
        }
        assert session.scalar(
            select(models.LTIUserSession).where(
                models.LTIUserSession.user_id == user.id
            )
        ) is not None


def test_lti_launch_parses_scope_string(client, monkeypatch):
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    _patch_platform_keys(monkeypatch)

    with database.SessionLocal() as session:
        _, _, workflow = _setup_registration(session)

    response = client.post(
        "/api/lti/login",
        data={
            "iss": "https://platform.example",
            "client_id": "platform-client",
            "lti_deployment_id": "deployment-123",
            "target_link_uri": "https://tool.example/api/lti/launch",
            "login_hint": "hint",
            "lti_message_hint": "resource-789",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302
    parsed = urlparse(response.headers["location"])
    state = parse_qs(parsed.query)["state"][0]

    with database.SessionLocal() as session:
        session_record = session.scalar(
            select(models.LTIUserSession).where(models.LTIUserSession.state == state)
        )
        assert session_record is not None
        nonce = session_record.nonce

    id_token = _build_id_token(
        nonce,
        "deployment-123",
        "LtiResourceLinkRequest",
        {
            "email": "learner@example.com",
            "https://purl.imsglobal.org/spec/lti/claim/resource_link": {
                "id": "resource-789"
            },
            "https://purl.imsglobal.org/spec/lti-ags/claim/endpoint": {
                "lineitems": "https://platform.example/contexts/123/lineitems",
                "lineitem": "https://platform.example/contexts/123/lineitems/quiz",
                "scope": "https://purl.imsglobal.org/spec/lti-ags/scope/score  https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
            },
        },
    )

    launch = client.post("/api/lti/launch", json={"state": state, "id_token": id_token})
    assert launch.status_code == 200

    with database.SessionLocal() as session:
        user = session.scalar(
            select(models.User).where(models.User.email == "learner@example.com")
        )
        assert user is not None
        resource_link = session.scalar(
            select(models.LTIResourceLink).where(
                models.LTIResourceLink.resource_link_id == "resource-789"
            )
        )
        assert resource_link is not None
        assert resource_link.workflow_id == workflow.id
        session_record = session.scalar(
            select(models.LTIUserSession).where(
                models.LTIUserSession.user_id == user.id
            )
        )
        assert session_record is not None
        assert session_record.ags_scopes == [
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
        ]


def test_lti_launch_without_deep_link_selection_returns_error(client, monkeypatch):
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    _patch_platform_keys(monkeypatch)

    with database.SessionLocal() as session:
        registration, deployment, _workflow = _setup_registration(session)

    response = client.post(
        "/api/lti/login",
        data={
            "iss": "https://platform.example",
            "client_id": "platform-client",
            "lti_deployment_id": "deployment-123",
            "target_link_uri": "https://tool.example/api/lti/launch",
            "login_hint": "hint",
            "lti_message_hint": "resource-789",
        },
        follow_redirects=False,
    )
    assert response.status_code == 302
    parsed = urlparse(response.headers["location"])
    state = parse_qs(parsed.query)["state"][0]

    with database.SessionLocal() as session:
        session_record = session.scalar(
            select(models.LTIUserSession).where(models.LTIUserSession.state == state)
        )
        assert session_record is not None
        nonce = session_record.nonce
        resource_link = session_record.resource_link
        assert resource_link is not None
        # Ensure no workflow has been selected for this resource link yet
        assert resource_link.workflow_id is None

    id_token = _build_id_token(
        nonce,
        "deployment-123",
        "LtiResourceLinkRequest",
        {
            "https://purl.imsglobal.org/spec/lti/claim/resource_link": {
                "id": "resource-789",
                "title": "Course activity",
            },
        },
    )

    launch = client.post("/api/lti/launch", json={"state": state, "id_token": id_token})
    assert launch.status_code == 400
    assert launch.json()["detail"] == "Aucun workflow associé au lancement LTI"


def test_lti_deep_link_returns_content_items(client, monkeypatch):
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    _patch_platform_keys(monkeypatch)

    with database.SessionLocal() as session:
        registration, deployment, workflow = _setup_registration(session)

    response = client.post(
        "/api/lti/login",
        data={
            "iss": "https://platform.example",
            "client_id": "platform-client",
            "lti_deployment_id": "deployment-123",
            "target_link_uri": "https://tool.example/api/lti/launch",
        },
        follow_redirects=False,
    )
    state = parse_qs(urlparse(response.headers["location"]).query)["state"][0]

    with database.SessionLocal() as session:
        session_record = session.scalar(
            select(models.LTIUserSession).where(models.LTIUserSession.state == state)
        )
        assert session_record is not None
        nonce = session_record.nonce

    id_token = _build_id_token(
        nonce,
        "deployment-123",
        "LtiDeepLinkingRequest",
        {
            "https://purl.imsglobal.org/spec/lti-dl/claim/return_url": "https://platform.example/return",
        },
    )

    result = client.post(
        "/api/lti/deep-link",
        json={
            "state": state,
            "id_token": id_token,
            "workflow_ids": [workflow.id],
        },
    )

    assert result.status_code == 200
    payload = result.json()
    assert payload["return_url"] == "https://platform.example/return"
    assert payload["content_items"][0]["custom"]["workflow_id"] == workflow.id

    claims = jwt.decode(
        payload["deep_link_jwt"],
        TOOL_KEY.public_key(),
        algorithms=["RS256"],
        audience="platform-audience",
        issuer="tool-client",
    )
    items = claims[
        "https://purl.imsglobal.org/spec/lti-dl/claim/content_items"
    ]
    assert items[0]["custom"]["workflow_slug"] == workflow.slug
