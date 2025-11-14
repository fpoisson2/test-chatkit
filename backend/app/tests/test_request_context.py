import datetime
import importlib
import os
import sys
from collections.abc import Sequence
from pathlib import Path

import pytest
from sqlalchemy import select

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "tests-auth-key")
os.environ.setdefault("APP_SETTINGS_SECRET_KEY", "tests-secret-key")


@pytest.fixture(autouse=True)
def _reset_settings(monkeypatch: pytest.MonkeyPatch):
    config = importlib.import_module("backend.app.config")
    config.get_settings.cache_clear()
    config.set_runtime_settings_overrides(None)
    yield
    config.set_runtime_settings_overrides(None)
    config.get_settings.cache_clear()


def _setup_lti_session(*, raw_scopes: Sequence[str] | None = None):
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")

    models.Base.metadata.create_all(bind=database.engine)

    with database.SessionLocal() as session:
        user = models.User(
            email="learner@lti.local",
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
            resource_link_id="resource-abc",
            workflow_id=None,
        )
        session.add(resource_link)
        session.flush()

        session_record = models.LTIUserSession(
            registration_id=registration.id,
            deployment_id=deployment.id,
            resource_link_id=resource_link.id,
            user_id=user.id,
            state="state-123",
            nonce="nonce-123",
            login_hint="hint",
            target_link_uri="https://tool.example/api/lti/launch",
            platform_user_id="platform-user",
            platform_context_id="course-1",
            expires_at=(
                datetime.datetime.now(datetime.UTC)
                + datetime.timedelta(minutes=5)
            ),
            launched_at=datetime.datetime.now(datetime.UTC),
            ags_line_items_endpoint="https://platform.example/lineitems",
            ags_line_item_endpoint="https://platform.example/lineitems/quiz",
            ags_scopes=(
                raw_scopes
                if raw_scopes is not None
                else [
                    "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
                    "https://purl.imsglobal.org/spec/lti-ags/scope/score",
                ]
            ),
            ags_line_item_claim={"scoreMaximum": 30, "label": "Quiz"},
        )
        session.add(session_record)
        session.commit()

        return user.id, session_record.id


def test_build_chatkit_request_context_includes_lti_data():
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    context_module = importlib.import_module("backend.app.request_context")

    user_id, session_id = _setup_lti_session()

    with database.SessionLocal() as db_session:
        current_user = db_session.scalar(
            select(models.User).where(models.User.id == user_id)
        )
        assert current_user is not None

        chatkit_context = context_module.build_chatkit_request_context(
            current_user,
            request=None,
            session=db_session,
        )

    assert chatkit_context.lti_session_id == session_id
    assert (
        chatkit_context.ags_line_items_endpoint == "https://platform.example/lineitems"
    )
    assert (
        chatkit_context.ags_line_item_endpoint
        == "https://platform.example/lineitems/quiz"
    )
    assert chatkit_context.ags_scopes == (
        "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
        "https://purl.imsglobal.org/spec/lti-ags/scope/score",
    )
    assert chatkit_context.ags_default_score_maximum == pytest.approx(30.0)
    assert chatkit_context.ags_default_label == "Quiz"
    trace = chatkit_context.trace_metadata()
    assert trace["lti_session_id"] == str(session_id)


def test_build_chatkit_request_context_splits_scope_strings():
    database = importlib.import_module("backend.app.database")
    models = importlib.import_module("backend.app.models")
    context_module = importlib.import_module("backend.app.request_context")

    raw_scopes = [
        "https://purl.imsglobal.org/spec/lti-ags/scope/score  https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
        " https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly ",
    ]
    user_id, _session_id = _setup_lti_session(raw_scopes=raw_scopes)

    with database.SessionLocal() as db_session:
        current_user = db_session.scalar(
            select(models.User).where(models.User.id == user_id)
        )
        assert current_user is not None

        chatkit_context = context_module.build_chatkit_request_context(
            current_user,
            request=None,
            session=db_session,
        )

    assert chatkit_context.ags_scopes == (
        "https://purl.imsglobal.org/spec/lti-ags/scope/score",
        "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem",
        "https://purl.imsglobal.org/spec/lti-ags/scope/lineitem.readonly",
    )
