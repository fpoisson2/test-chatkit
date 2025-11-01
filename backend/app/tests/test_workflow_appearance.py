import os
import sys
from pathlib import Path

import pytest
from fastapi import FastAPI, status
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app.admin_settings import DEFAULT_APPEARANCE_ACCENT_COLOR  # noqa: E402
from backend.app.models import Base  # noqa: E402
from backend.app.routes import workflows as workflows_routes  # noqa: E402
from backend.app.schemas import (  # noqa: E402
    WorkflowAppearanceUpdateRequest,
)
from backend.app.workflows.service import WorkflowService  # noqa: E402
from backend.app.workflows.utils import WorkflowDefaults  # noqa: E402


def _load_workflow_defaults() -> WorkflowDefaults:
    defaults_path = ROOT_DIR / "backend" / "app" / "workflows" / "defaults.json"
    payload = defaults_path.read_text(encoding="utf-8")
    return WorkflowDefaults.from_json(payload)


SIMPLE_GRAPH = {
    "nodes": [
        {"slug": "start", "kind": "start", "is_enabled": True},
        {
            "slug": "assistant",
            "kind": "assistant_message",
            "is_enabled": True,
            "parameters": {"message": "Hello"},
        },
        {"slug": "end", "kind": "end", "is_enabled": True},
    ],
    "edges": [
        {"source": "start", "target": "assistant"},
        {"source": "assistant", "target": "end"},
    ],
}


@pytest.fixture()
def session_factory() -> sessionmaker[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        engine.dispose()


@pytest.fixture()
def workflow_service(session_factory: sessionmaker[Session]) -> WorkflowService:
    defaults = _load_workflow_defaults()
    return WorkflowService(session_factory=session_factory, workflow_defaults=defaults)


def test_service_get_and_update_workflow_appearance(
    workflow_service: WorkflowService,
) -> None:
    workflow = workflow_service.create_workflow(
        slug="custom-workflow",
        display_name="Custom workflow",
        description=None,
        graph_payload=SIMPLE_GRAPH,
    )

    result = workflow_service.get_workflow_appearance(workflow.id)
    assert result["target_kind"] == "local"
    assert result["workflow_id"] == workflow.id
    assert result["override"] is None
    assert result["inherited_from_global"] is True
    assert result["effective"]["accent_color"] == DEFAULT_APPEARANCE_ACCENT_COLOR

    update_payload = {
        "color_scheme": "dark",
        "accent_color": "#112233",
        "start_screen_greeting": "Bonjour",
    }
    updated = workflow_service.update_workflow_appearance(
        workflow.id, update_payload
    )
    override = updated["override"]
    assert override is not None
    assert override["color_scheme"] == "dark"
    assert override["accent_color"] == "#112233"
    assert override["start_screen_greeting"] == "Bonjour"
    assert updated["inherited_from_global"] is False
    assert updated["effective"]["accent_color"] == "#112233"

    reset = workflow_service.update_workflow_appearance(
        workflow.id, {"inherit_from_global": True}
    )
    assert reset["override"] is None
    assert reset["inherited_from_global"] is True


def test_service_handles_hosted_workflow_appearance(
    workflow_service: WorkflowService,
) -> None:
    hosted = workflow_service.create_hosted_workflow(
        slug="support-pro",
        workflow_id="remote-42",
        label="Support Pro",
    )

    fetched = workflow_service.get_workflow_appearance(hosted.slug)
    assert fetched["target_kind"] == "hosted"
    assert fetched["workflow_slug"] == "support-pro"
    assert fetched["remote_workflow_id"] == "remote-42"
    assert fetched["override"] is None

    workflow_service.update_workflow_appearance(
        hosted.slug, {"accent_color": "#abcdef"}
    )
    override_entry = workflow_service.get_workflow_appearance(hosted.slug)
    assert override_entry["override"] is not None
    assert override_entry["override"]["accent_color"] == "#abcdef"


class _StubUser:
    def __init__(self, *, is_admin: bool) -> None:
        self.is_admin = is_admin


@pytest.fixture()
def test_client(
    session_factory: sessionmaker[Session],
    workflow_service: WorkflowService,
    monkeypatch: pytest.MonkeyPatch,
) -> TestClient:
    app = FastAPI()
    app.include_router(workflows_routes.router)

    def _get_session():
        with session_factory() as session:
            yield session

    app.dependency_overrides[workflows_routes.get_session] = _get_session
    app.dependency_overrides[workflows_routes.get_current_user] = lambda: _StubUser(
        is_admin=True
    )

    monkeypatch.setattr(
        workflows_routes, "WorkflowService", lambda: workflow_service
    )

    return TestClient(app)


def test_route_requires_admin(
    test_client: TestClient,
    session_factory: sessionmaker[Session],
) -> None:
    app = test_client.app
    app.dependency_overrides[workflows_routes.get_current_user] = lambda: _StubUser(
        is_admin=False
    )
    response = test_client.get("/api/workflows/1/appearance")
    assert response.status_code == status.HTTP_403_FORBIDDEN
    app.dependency_overrides[workflows_routes.get_current_user] = lambda: _StubUser(
        is_admin=True
    )


def test_route_get_and_patch_workflow_appearance(
    test_client: TestClient,
    workflow_service: WorkflowService,
) -> None:
    workflow = workflow_service.create_workflow(
        slug="chat-support",
        display_name="Chat Support",
        description=None,
        graph_payload=SIMPLE_GRAPH,
    )

    response = test_client.get(f"/api/workflows/{workflow.id}/appearance")
    assert response.status_code == status.HTTP_200_OK
    payload = response.json()
    assert payload["target_kind"] == "local"
    assert payload["inherited_from_global"] is True

    update_request = WorkflowAppearanceUpdateRequest(
        color_scheme="light",
        accent_color="#778899",
    )
    response = test_client.patch(
        f"/api/workflows/{workflow.id}/appearance",
        json=update_request.model_dump(exclude_unset=True),
    )
    assert response.status_code == status.HTTP_200_OK
    updated = response.json()
    assert updated["override"]["accent_color"] == "#778899"
    assert updated["override"]["color_scheme"] == "light"

    response = test_client.patch(
        f"/api/workflows/{workflow.id}/appearance",
        json={"inherit_from_global": True},
    )
    assert response.status_code == status.HTTP_200_OK
    reset_payload = response.json()
    assert reset_payload["override"] is None
    assert reset_payload["inherited_from_global"] is True

