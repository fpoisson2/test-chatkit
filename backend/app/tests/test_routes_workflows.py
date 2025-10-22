import asyncio
import datetime
import importlib
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, status

if importlib.util.find_spec("fastapi") is None:  # pragma: no cover - env réduit
    pytest.skip("fastapi non disponible", allow_module_level=True)

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

routes_workflows = importlib.import_module("backend.app.routes.workflows")
schemas = importlib.import_module("backend.app.schemas")


class _StubUser:
    is_admin = True


def _build_graph_payload():
    return schemas.WorkflowGraphInput(
        nodes=[
            schemas.WorkflowNodeInput(slug="start", kind="start"),
            schemas.WorkflowNodeInput(slug="end", kind="end"),
        ],
        edges=[schemas.WorkflowEdgeInput(source="start", target="end")],
    )


def test_import_workflow_success(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        captured: dict[str, object] = {}

        class _StubService:
            def import_workflow(self, **kwargs):  # type: ignore[no-untyped-def]
                captured.update(kwargs)
                return {"definition": "ok"}

        expected_timestamp = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
        expected_payload = {
            "id": 7,
            "workflow_id": 3,
            "workflow_slug": "demo",
            "workflow_display_name": "Demo",
            "workflow_is_chatkit_default": False,
            "name": "Import",
            "version": 4,
            "is_active": False,
            "created_at": expected_timestamp,
            "updated_at": expected_timestamp,
            "steps": [],
            "graph": {"nodes": [], "edges": []},
        }

        monkeypatch.setattr(routes_workflows, "WorkflowService", lambda: _StubService())

        def _serialize(_definition):
            return expected_payload

        monkeypatch.setattr(routes_workflows, "serialize_definition", _serialize)

        payload = schemas.WorkflowImportRequest(
            workflow_id=3,
            version_name="Import",
            graph=_build_graph_payload(),
        )

        result = await routes_workflows.import_workflow_definition(
            payload, session=SimpleNamespace(), current_user=_StubUser()
        )

        assert result.model_dump() == expected_payload
        assert captured["workflow_id"] == 3
        assert captured["graph_payload"] == payload.graph.model_dump()

    asyncio.run(_run())


def test_import_workflow_validation_error(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        class _StubService:
            def import_workflow(self, **_kwargs):  # type: ignore[no-untyped-def]
                raise routes_workflows.WorkflowValidationError("invalide")

        monkeypatch.setattr(routes_workflows, "WorkflowService", lambda: _StubService())

        payload = schemas.WorkflowImportRequest(
            workflow_id=1,
            graph=_build_graph_payload(),
        )

        with pytest.raises(HTTPException) as excinfo:
            await routes_workflows.import_workflow_definition(
                payload, session=SimpleNamespace(), current_user=_StubUser()
            )

        assert excinfo.value.status_code == status.HTTP_400_BAD_REQUEST

    asyncio.run(_run())


def test_import_workflow_not_found(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _run() -> None:
        class _StubService:
            def import_workflow(self, **_kwargs):  # type: ignore[no-untyped-def]
                raise routes_workflows.WorkflowNotFoundError(99)

        monkeypatch.setattr(routes_workflows, "WorkflowService", lambda: _StubService())

        payload = schemas.WorkflowImportRequest(
            workflow_id=99,
            graph=_build_graph_payload(),
        )

        with pytest.raises(HTTPException) as excinfo:
            await routes_workflows.import_workflow_definition(
                payload, session=SimpleNamespace(), current_user=_StubUser()
            )

        assert excinfo.value.status_code == status.HTTP_404_NOT_FOUND

    asyncio.run(_run())
