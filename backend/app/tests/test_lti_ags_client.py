import datetime
import importlib
import json
import os
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "tests-auth-key")
os.environ.setdefault("APP_SETTINGS_SECRET_KEY", "tests-secret-key")
os.environ.setdefault("BACKEND_PUBLIC_BASE_URL", "https://tool.example")


def _generate_private_key() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(
        encoding=serialization.Encoding.PEM,
        format=serialization.PrivateFormat.PKCS8,
        encryption_algorithm=serialization.NoEncryption(),
    )
    return pem.decode()


PRIVATE_KEY = _generate_private_key()
os.environ.setdefault("LTI_TOOL_PRIVATE_KEY", PRIVATE_KEY)
os.environ.setdefault("LTI_TOOL_KEY_ID", "tool-key")
os.environ.setdefault("LTI_TOOL_CLIENT_ID", "tool-client")


@pytest.fixture(autouse=True)
def _reset_settings(monkeypatch: pytest.MonkeyPatch):
    config = importlib.import_module("backend.app.config")
    config.get_settings.cache_clear()
    config.set_runtime_settings_overrides(None)
    yield
    config.set_runtime_settings_overrides(None)
    config.get_settings.cache_clear()


def _setup_lti_entities() -> dict[str, Any]:
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")

    models.Base.metadata.create_all(bind=database.engine)

    with database.SessionLocal() as session:
        user = models.User(
            email="student@lti.local",
            password_hash="hash",
            is_admin=False,
        )
        session.add(user)
        session.flush()

        registration = models.LTIRegistration(
            issuer="https://platform.example",
            client_id="platform-client",
            key_set_url="https://platform.example/jwks",
            authorization_endpoint="https://platform.example/oidc",
            token_endpoint="https://platform.example/token",
        )
        session.add(registration)
        session.flush()

        deployment = models.LTIDeployment(
            registration_id=registration.id,
            deployment_id="deployment-1",
            workflow_id=None,
        )
        session.add(deployment)
        session.flush()

        resource_link = models.LTIResourceLink(
            deployment_id=deployment.id,
            resource_link_id="resource-xyz",
            workflow_id=None,
        )
        session.add(resource_link)
        session.flush()

        session_record = models.LTIUserSession(
            registration_id=registration.id,
            deployment_id=deployment.id,
            resource_link_id=resource_link.id,
            user_id=user.id,
            state="state-1",
            nonce="nonce-1",
            login_hint="hint",
            target_link_uri="https://tool.example/api/lti/launch",
            platform_user_id="platform-user",
            platform_context_id="course-xyz",
            expires_at=(
                datetime.datetime.now(datetime.UTC)
                + datetime.timedelta(minutes=5)
            ),
            launched_at=datetime.datetime.now(datetime.UTC),
        )
        session.add(session_record)
        session.commit()

        return {
            "registration_id": registration.id,
            "resource_link_id": resource_link.id,
            "resource_link_ref": resource_link.resource_link_id,
            "user_id": user.id,
            "session_id": session_record.id,
        }


@pytest.mark.anyio
async def test_lti_ags_client_creates_line_item_and_publishes_score():
    database = importlib.import_module("backend.app.database")
    context_module = importlib.import_module("backend.app.chatkit_server.context")
    config = importlib.import_module("backend.app.config")
    ags_module = importlib.import_module("backend.app.lti.ags")

    ids = _setup_lti_entities()
    settings = config.get_settings()

    requests: list[tuple[str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append((request.method, request.url.path))
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "token", "token_type": "Bearer"},
            )
        if request.method == "GET" and request.url.path == "/lineitems":
            assert request.url.params["resource_id"] == "score-1"
            return httpx.Response(200, json=[])
        if request.method == "POST" and request.url.path == "/lineitems":
            payload = json.loads(request.content.decode())
            assert payload["resourceId"] == "score-1"
            assert payload["label"] == "Excellent"
            assert payload["scoreMaximum"] == 20.0
            return httpx.Response(
                201,
                json={"id": "https://platform.example/lineitems/score-1"},
            )
        if request.method == "GET" and request.url.path == "/lineitems/score-1":
            return httpx.Response(
                200,
                json={
                    "id": "https://platform.example/lineitems/score-1",
                    "scoreMaximum": 25.0,
                },
            )
        if request.method == "POST" and request.url.path == "/lineitems/score-1/scores":
            payload = json.loads(request.content.decode())
            assert payload["userId"] == "platform-user"
            assert payload["scoreGiven"] == pytest.approx(18.0)
            assert payload["scoreMaximum"] == pytest.approx(25.0)
            assert "comment" not in payload
            return httpx.Response(200)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)

    @asynccontextmanager
    async def client_factory() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
            yield client

    ags_client = ags_module.LTIAGSClient(
        session_factory=database.SessionLocal,
        settings=settings,
        http_client_factory=client_factory,
    )

    chatkit_context = context_module.ChatKitRequestContext(
        user_id=str(ids["user_id"]),
        email="student@lti.local",
        lti_session_id=ids["session_id"],
        lti_registration_id=ids["registration_id"],
        lti_resource_link_id=ids["resource_link_id"],
        lti_resource_link_ref=ids["resource_link_ref"],
        lti_platform_user_id="platform-user",
        ags_line_items_endpoint="https://platform.example/lineitems",
        ags_scopes=(
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        ),
        ags_default_score_maximum=20.0,
        ags_default_label="Quiz final",
    )

    line_item_id = await ags_client.ensure_line_item(
        context=chatkit_context,
        variable_id="score-1",
        max_score=20.0,
        comment="Excellent",
    )
    assert line_item_id == "https://platform.example/lineitems/score-1"

    await ags_client.publish_score(
        context=chatkit_context,
        line_item_id=line_item_id,
        variable_id="score-1",
        score=18.0,
        max_score=20.0,
        comment="Bravo",
    )

    assert requests == [
        ("POST", "/token"),
        ("GET", "/lineitems"),
        ("POST", "/lineitems"),
        ("POST", "/token"),
        ("GET", "/lineitems/score-1"),
        ("POST", "/lineitems/score-1/scores"),
    ]


@pytest.mark.anyio
async def test_publish_score_preserves_query_string_for_line_item():
    database = importlib.import_module("backend.app.database")
    context_module = importlib.import_module("backend.app.chatkit_server.context")
    config = importlib.import_module("backend.app.config")
    ags_module = importlib.import_module("backend.app.lti.ags")

    ids = _setup_lti_entities()
    settings = config.get_settings()

    captured: list[tuple[str, str, str]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append((request.method, request.url.path, request.url.query))
        if request.url.path == "/token":
            return httpx.Response(
                200,
                json={"access_token": "token", "token_type": "Bearer"},
            )
        if request.method == "GET" and request.url.path == "/lineitems/score-99":
            return httpx.Response(
                200,
                json={
                    "id": "https://platform.example/lineitems/score-99",
                    "scoreMaximum": 30.0,
                },
            )
        if (
            request.method == "POST"
            and request.url.path == "/lineitems/score-99/scores"
            and request.url.query == "type_id=6"
        ):
            assert (
                request.headers["content-type"]
                == "application/vnd.ims.lis.v1.score+json"
            )
            payload = json.loads(request.content.decode())
            assert payload["userId"] == "platform-user"
            assert payload["scoreGiven"] == pytest.approx(12.5)
            assert payload["scoreMaximum"] == pytest.approx(30.0)
            assert "comment" not in payload
            return httpx.Response(200)
        return httpx.Response(404)

    transport = httpx.MockTransport(handler)

    @asynccontextmanager
    async def client_factory() -> AsyncIterator[httpx.AsyncClient]:
        async with httpx.AsyncClient(transport=transport, timeout=5.0) as client:
            yield client

    ags_client = ags_module.LTIAGSClient(
        session_factory=database.SessionLocal,
        settings=settings,
        http_client_factory=client_factory,
    )

    chatkit_context = context_module.ChatKitRequestContext(
        user_id=str(ids["user_id"]),
        email="student@lti.local",
        lti_session_id=ids["session_id"],
        lti_registration_id=ids["registration_id"],
        lti_resource_link_id=ids["resource_link_id"],
        lti_resource_link_ref=ids["resource_link_ref"],
        lti_platform_user_id="platform-user",
        ags_line_items_endpoint="https://platform.example/lineitems",
        ags_scopes=(
            "https://purl.imsglobal.org/spec/lti-ags/scope/score",
            "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
        ),
        ags_default_score_maximum=20.0,
    )

    await ags_client.publish_score(
        context=chatkit_context,
        line_item_id="https://platform.example/lineitems/score-99?type_id=6",
        variable_id="score-99",
        score=12.5,
        max_score=None,
        comment=None,
    )

    assert captured == [
        ("POST", "/token", ""),
        ("GET", "/lineitems/score-99", ""),
        ("POST", "/lineitems/score-99/scores", "type_id=6"),
    ]


def test_build_scores_endpoint_places_scores_segment_before_query_string():
    ags_module = importlib.import_module("backend.app.lti.ags")

    build = ags_module.LTIAGSClient._build_scores_endpoint

    assert (
        build("https://platform.example/lineitems/score-1?type_id=6")
        == "https://platform.example/lineitems/score-1/scores?type_id=6"
    )
    assert (
        build(" https://platform.example/lineitems/score-1  ")
        == "https://platform.example/lineitems/score-1/scores"
    )
    assert build("") == ""


def test_format_score_timestamp_uses_z_suffix_with_second_precision():
    ags_module = importlib.import_module("backend.app.lti.ags")

    sample = datetime.datetime(
        2025,
        11,
        14,
        20,
        20,
        24,
        902_127,
        tzinfo=datetime.timezone.utc,
    )

    formatted = ags_module.LTIAGSClient._format_score_timestamp(sample)

    assert formatted == "2025-11-14T20:20:24Z"


def test_format_score_timestamp_normalizes_naive_datetime_to_utc():
    ags_module = importlib.import_module("backend.app.lti.ags")

    naive = datetime.datetime(2025, 11, 14, 20, 20, 24, 123_456)

    formatted = ags_module.LTIAGSClient._format_score_timestamp(naive)

    assert formatted == "2025-11-14T20:20:24Z"


def test_normalize_score_clamps_within_bounds():
    ags_module = importlib.import_module("backend.app.lti.ags")

    normalize = ags_module.LTIAGSClient._normalize_score

    assert normalize(50, 100) == pytest.approx(0.5)
    assert normalize(150, 100) == pytest.approx(1.0)
    assert normalize(-10, 100) == pytest.approx(0.0)
    assert normalize(5, 0) == pytest.approx(0.0)
