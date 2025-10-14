from __future__ import annotations

import atexit
import os
from typing import Any

os.environ.setdefault("USE_TF", "0")
os.environ.setdefault("USE_FLAX", "0")
os.environ.pop("ADMIN_EMAIL", None)
os.environ.pop("ADMIN_PASSWORD", None)

from backend.app.config import get_settings

get_settings.cache_clear()

from fastapi.testclient import TestClient
from sqlalchemy import select, text

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import (
    Base,
    User,
    Workflow,
    WorkflowDefinition,
    WorkflowStep,
    WorkflowTransition,
)
from backend.app.security import create_access_token, hash_password

_db_path = engine.url.database or ""


def _reset_db() -> None:
    """Réinitialise le schéma en fonction du dialecte utilisé."""

    if engine.dialect.name == "postgresql":
        Base.metadata.create_all(bind=engine)
        table_names = ", ".join(f'"{name}"' for name in Base.metadata.tables)
        if not table_names:
            return
        with engine.begin() as connection:
            connection.execute(
                text(
                    f"TRUNCATE TABLE {table_names} RESTART IDENTITY CASCADE"
                )
            )
    else:
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)


_reset_db()

client = TestClient(app)


def _cleanup() -> None:
    if _db_path and os.path.exists(_db_path):
        try:
            os.remove(_db_path)
        except FileNotFoundError:
            pass


atexit.register(_cleanup)


def _make_user(*, email: str, is_admin: bool) -> User:
    with SessionLocal() as session:
        user = User(
            email=email,
            password_hash=hash_password("password"),
            is_admin=is_admin,
        )
        session.add(user)
        session.commit()
        session.refresh(user)
        return user


def _auth_headers(token: str | None = None) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


def _simple_graph() -> dict[str, Any]:
    return {
        "nodes": [
            {"slug": "start", "kind": "start", "is_enabled": True},
            {
                "slug": "agent-triage",
                "kind": "agent",
                "agent_key": "triage",
                "is_enabled": True,
                "parameters": {},
            },
            {"slug": "end", "kind": "end", "is_enabled": True},
        ],
        "edges": [
            {"source": "start", "target": "agent-triage"},
            {"source": "agent-triage", "target": "end"},
        ],
    }


def test_get_workflow_requires_authentication() -> None:
    response = client.get("/api/workflows/current")
    assert response.status_code == 401


def test_get_workflow_requires_admin() -> None:
    user = _make_user(email="user@example.com", is_admin=False)
    token = create_access_token(user)
    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 403


def test_admin_can_read_default_graph() -> None:
    admin = _make_user(email="workflow-admin@example.com", is_admin=True)
    token = create_access_token(admin)
    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 200
    payload = response.json()
    nodes = {node["slug"]: node for node in payload["graph"]["nodes"]}
    assert {"start", "end", "infos-completes", "finalisation"}.issubset(nodes.keys())
    state_slugs = {
        node["slug"]
        for node in payload["graph"]["nodes"]
        if node.get("kind") == "state"
    }
    assert {"maj-etat-triage", "maj-etat-validation"}.issubset(state_slugs)
    edges = {(edge["source"], edge["target"]) for edge in payload["graph"]["edges"]}
    assert ("start", "analyse") in edges
    agent_keys = [step["agent_key"] for step in payload["steps"]]
    assert "r_dacteur" in agent_keys


def test_admin_can_update_workflow_graph_with_parameters() -> None:
    admin = _make_user(email="owner@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "graph": {
            "nodes": [
                {"slug": "start", "kind": "start", "is_enabled": True},
                {
                    "slug": "analyse",
                    "kind": "agent",
                    "agent_key": "triage",
                    "parameters": {"temperature": 0.2},
                    "is_enabled": True,
                },
                {
                    "slug": "decision",
                    "kind": "condition",
                    "parameters": {"mode": "truthy", "path": "has_all_details"},
                },
                {
                    "slug": "final",
                    "kind": "agent",
                    "agent_key": "r_dacteur",
                    "parameters": {"model": "gpt-4.1"},
                    "is_enabled": True,
                },
                {"slug": "end", "kind": "end"},
            ],
            "edges": [
                {"source": "start", "target": "analyse"},
                {"source": "analyse", "target": "decision"},
                {"source": "decision", "target": "final", "condition": "true"},
                {"source": "decision", "target": "final", "condition": "false"},
                {"source": "final", "target": "end"},
            ],
        }
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 200
    data = response.json()
    nodes = {node["slug"]: node for node in data["graph"]["nodes"]}
    assert nodes["analyse"]["parameters"]["temperature"] == 0.2
    redacteur = next(step for step in data["steps"] if step["agent_key"] == "r_dacteur")
    assert redacteur["parameters"]["model"] == "gpt-4.1"


def test_legacy_workflow_is_backfilled_with_default_graph() -> None:
    admin = _make_user(email="legacy@example.com", is_admin=True)
    token = create_access_token(admin)

    with SessionLocal() as session:
        session.query(WorkflowTransition).delete()
        session.query(WorkflowStep).delete()
        session.query(WorkflowDefinition).delete()
        session.commit()

        workflow = session.scalar(select(Workflow).where(Workflow.slug == "workflow-par-defaut"))
        if workflow is None:
            workflow = Workflow(slug="workflow-par-defaut", display_name="Workflow par défaut")
            session.add(workflow)
            session.flush()

        definition = WorkflowDefinition(
            workflow_id=workflow.id,
            name="ancien-workflow",
            is_active=True,
        )
        session.add(definition)
        session.flush()

        legacy_agents = [
            ("triage", {"instructions": "Analyse initiale", "model": "gpt-4.1-mini"}),
            ("get_data_from_web", {"instructions": "Cherche les infos"}),
            ("triage_2", {"instructions": "Valide les données", "model": "gpt-4.1-mini"}),
            ("get_data_from_user", {"instructions": "Demande des précisions"}),
            ("r_dacteur", {"instructions": "Rédige la synthèse", "model": "o4-mini"}),
        ]

        for index, (agent_key, parameters) in enumerate(legacy_agents, start=1):
            session.add(
                WorkflowStep(
                    definition_id=definition.id,
                    slug=f"step_{index}",
                    kind="agent",
                    display_name=f"Étape {index}",
                    agent_key=agent_key,
                    position=index,
                    is_enabled=True,
                    parameters=parameters,
                )
            )

        session.commit()

    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 200
    payload = response.json()

    slugs = {node["slug"] for node in payload["graph"]["nodes"]}
    assert {"start", "end", "infos-completes", "pret-final"}.issubset(slugs)

    edges = {(edge["source"], edge["target"], edge.get("condition")) for edge in payload["graph"]["edges"]}
    assert ("infos-completes", "finalisation", "true") in edges
    assert ("pret-final", "collecte-utilisateur", "false") in edges

    redacteur_node = next(node for node in payload["graph"]["nodes"] if node["slug"] == "finalisation")
    assert redacteur_node["parameters"]["instructions"] == "Rédige la synthèse"

    redacteur_step = next(step for step in payload["steps"] if step["agent_key"] == "r_dacteur")
    assert redacteur_step["parameters"]["model"] == "o4-mini"


def test_legacy_workflow_missing_state_nodes_is_backfilled() -> None:
    admin = _make_user(email="stateless@example.com", is_admin=True)
    token = create_access_token(admin)

    with SessionLocal() as session:
        session.query(WorkflowTransition).delete()
        session.query(WorkflowStep).delete()
        session.query(WorkflowDefinition).delete()
        session.commit()

        workflow = session.scalar(select(Workflow).where(Workflow.slug == "workflow-par-defaut"))
        if workflow is None:
            workflow = Workflow(slug="workflow-par-defaut", display_name="Workflow par défaut")
            session.add(workflow)
            session.flush()

        definition = WorkflowDefinition(
            workflow_id=workflow.id,
            name="workflow-sans-etat",
            is_active=True,
        )
        session.add(definition)
        session.flush()

        steps = [
            ("start", "start", None, None),
            ("analyse", "agent", "triage", {"instructions": "Analyse initiale"}),
            ("infos-completes", "condition", None, {"mode": "truthy", "path": "has_all_details"}),
            ("collecte-web", "agent", "get_data_from_web", {"instructions": "Recherche en ligne"}),
            ("validation", "agent", "triage_2", {"instructions": "Valide"}),
            ("pret-final", "condition", None, {"mode": "truthy", "path": "should_finalize"}),
            ("collecte-utilisateur", "agent", "get_data_from_user", {"instructions": "Demander"}),
            ("finalisation", "agent", "r_dacteur", {"instructions": "Synthèse"}),
            ("end", "end", None, None),
        ]

        step_map: dict[str, WorkflowStep] = {}
        for index, (slug, kind, agent_key, parameters) in enumerate(steps, start=1):
            step = WorkflowStep(
                definition_id=definition.id,
                slug=slug,
                kind=kind,
                agent_key=agent_key,
                position=index,
                is_enabled=True,
                parameters=parameters,
            )
            session.add(step)
            step_map[slug] = step

        session.flush()

        transitions = [
            ("start", "analyse", None),
            ("analyse", "infos-completes", None),
            ("infos-completes", "finalisation", "true"),
            ("infos-completes", "collecte-web", "false"),
            ("collecte-web", "validation", None),
            ("validation", "pret-final", None),
            ("pret-final", "finalisation", "true"),
            ("pret-final", "collecte-utilisateur", "false"),
            ("collecte-utilisateur", "finalisation", None),
            ("finalisation", "end", None),
        ]

        for source, target, condition in transitions:
            session.add(
                WorkflowTransition(
                    definition_id=definition.id,
                    source_step=step_map[source],
                    target_step=step_map[target],
                    condition=condition,
                    ui_metadata={},
                )
            )

        session.commit()

    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 200
    payload = response.json()

    state_slugs = {
        node["slug"]
        for node in payload["graph"]["nodes"]
        if node.get("kind") == "state"
    }
    assert {"maj-etat-triage", "maj-etat-validation"}.issubset(state_slugs)

    analyse_node = next(node for node in payload["graph"]["nodes"] if node["slug"] == "analyse")
    assert analyse_node["parameters"]["instructions"] == "Analyse initiale"


def test_update_rejects_unknown_agent() -> None:
    admin = _make_user(email="validator@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "graph": {
            "nodes": [
                {"slug": "start", "kind": "start"},
                {"slug": "invalid", "kind": "agent", "agent_key": "unknown"},
                {"slug": "final", "kind": "agent", "agent_key": "r_dacteur"},
                {"slug": "end", "kind": "end"},
            ],
            "edges": [
                {"source": "start", "target": "invalid"},
                {"source": "invalid", "target": "final"},
                {"source": "final", "target": "end"},
            ],
        }
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 400
    assert "Agent inconnu" in response.json()["detail"]


def test_update_accepts_custom_agent_without_key() -> None:
    admin = _make_user(email="custom@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "graph": {
            "nodes": [
                {"slug": "start", "kind": "start"},
                {
                    "slug": "redacteur-sur-mesure",
                    "kind": "agent",
                    "parameters": {
                        "instructions": "Rédige une réponse personnalisée.",
                        "model": "gpt-4.1-mini",
                    },
                },
                {"slug": "end", "kind": "end"},
            ],
            "edges": [
                {"source": "start", "target": "redacteur-sur-mesure"},
                {"source": "redacteur-sur-mesure", "target": "end"},
            ],
        }
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 200
    body = response.json()
    nodes = body["graph"]["nodes"]
    custom = next(node for node in nodes if node["slug"] == "redacteur-sur-mesure")
    assert custom["agent_key"] is None
    assert custom["parameters"]["instructions"] == "Rédige une réponse personnalisée."


def test_update_condition_requires_branches() -> None:
    admin = _make_user(email="condition@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "graph": {
            "nodes": [
                {"slug": "start", "kind": "start"},
                {
                    "slug": "decision",
                    "kind": "condition",
                    "parameters": {"path": "has_all_details"},
                },
                {"slug": "writer", "kind": "agent", "agent_key": "r_dacteur"},
                {"slug": "end", "kind": "end"},
            ],
            "edges": [
                {"source": "start", "target": "decision"},
                {"source": "decision", "target": "writer", "condition": "true"},
                {"source": "writer", "target": "end"},
            ],
        }
    }
    response = client.put(
        "/api/workflows/current",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 400
    assert "conditionnel" in response.json()["detail"].lower()


def test_create_workflow_without_graph_creates_empty_version() -> None:
    admin = _make_user(email="builder@example.com", is_admin=True)
    token = create_access_token(admin)
    payload = {
        "slug": "nouveau-workflow",
        "display_name": "Nouveau workflow",
        "description": None,
        "graph": None,
    }
    response = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json=payload,
    )
    assert response.status_code == 201
    data = response.json()
    assert data["workflow_slug"] == payload["slug"]
    assert data["name"] == "Version initiale"
    assert data["is_active"] is False
    assert data["steps"] == []
    node_slugs = {node["slug"] for node in data["graph"]["nodes"]}
    assert node_slugs == {"start", "end"}
    edge_pairs = {(edge["source"], edge["target"]) for edge in data["graph"]["edges"]}
    assert edge_pairs == {("start", "end")}

    library_response = client.get("/api/workflows", headers=_auth_headers(token))
    assert library_response.status_code == 200
    summaries = library_response.json()
    created = next(item for item in summaries if item["id"] == data["workflow_id"])
    assert created["versions_count"] == 1
    assert created["active_version_id"] is None


def test_can_save_minimal_graph_version() -> None:
    admin = _make_user(email="minimal@example.com", is_admin=True)
    token = create_access_token(admin)

    creation = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json={
            "slug": "workflow-minimal",
            "display_name": "Workflow minimal",
            "description": None,
            "graph": None,
        },
    )
    assert creation.status_code == 201
    workflow_id = creation.json()["workflow_id"]

    response = client.post(
        f"/api/workflows/{workflow_id}/versions",
        headers=_auth_headers(token),
        json={
            "graph": {
                "nodes": [
                    {"slug": "start", "kind": "start", "is_enabled": True},
                    {"slug": "end", "kind": "end", "is_enabled": True},
                ],
                "edges": [
                    {"source": "start", "target": "end"},
                ],
            },
            "mark_as_active": False,
        },
    )

    assert response.status_code == 201
    body = response.json()
    assert body["version"] == 2
    assert body["is_active"] is False
    assert len(body["graph"]["nodes"]) == 2
    assert {node["kind"] for node in body["graph"]["nodes"]} == {"start", "end"}
    assert body["steps"] == []


def test_create_two_workflows_with_same_initial_name() -> None:
    admin = _make_user(email="librarian@example.com", is_admin=True)
    token = create_access_token(admin)

    for index in range(2):
        payload = {
            "slug": f"workflow-{index}",
            "display_name": f"Workflow {index}",
            "description": None,
            "graph": None,
        }
        response = client.post(
            "/api/workflows",
            headers=_auth_headers(token),
            json=payload,
        )
        assert response.status_code == 201
        body = response.json()
        assert body["name"] == "Version initiale"

    library_response = client.get("/api/workflows", headers=_auth_headers(token))
    assert library_response.status_code == 200
    slugs = {item["slug"] for item in library_response.json()}
    assert {"workflow-0", "workflow-1"}.issubset(slugs)


def test_admin_can_delete_a_workflow() -> None:
    admin = _make_user(email="deleter@example.com", is_admin=True)
    token = create_access_token(admin)

    creation = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json={
            "slug": "workflow-a-supprimer",
            "display_name": "Workflow à supprimer",
            "graph": None,
        },
    )
    assert creation.status_code == 201
    workflow_id = creation.json()["workflow_id"]

    deletion = client.delete(
        f"/api/workflows/{workflow_id}",
        headers=_auth_headers(token),
    )
    assert deletion.status_code == 204

    library_response = client.get("/api/workflows", headers=_auth_headers(token))
    assert library_response.status_code == 200
    ids = {item["id"] for item in library_response.json()}
    assert workflow_id not in ids


def test_default_workflow_cannot_be_deleted() -> None:
    admin = _make_user(email="guardian@example.com", is_admin=True)
    token = create_access_token(admin)

    library_response = client.get("/api/workflows", headers=_auth_headers(token))
    assert library_response.status_code == 200
    default_id = next(item["id"] for item in library_response.json() if item["slug"] == "workflow-par-defaut")

    deletion = client.delete(
        f"/api/workflows/{default_id}",
        headers=_auth_headers(token),
    )
    assert deletion.status_code == 400
    assert "peut pas" in deletion.json()["detail"].lower()


def test_cannot_set_chatkit_workflow_without_active_version() -> None:
    admin = _make_user(email="selector@example.com", is_admin=True)
    token = create_access_token(admin)

    creation = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json={
            "slug": "workflow-sans-prod",
            "display_name": "Workflow sans prod",
            "graph": None,
        },
    )
    workflow_id = creation.json()["workflow_id"]

    response = client.post(
        "/api/workflows/chatkit",
        headers=_auth_headers(token),
        json={"workflow_id": workflow_id},
    )

    assert response.status_code == 400
    assert "production" in response.json()["detail"].lower()


def test_admin_can_select_chatkit_workflow() -> None:
    admin = _make_user(email="switcher@example.com", is_admin=True)
    token = create_access_token(admin)

    creation = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json={
            "slug": "workflow-alternatif",
            "display_name": "Workflow alternatif",
            "graph": {
                "nodes": _simple_graph()["nodes"],
                "edges": _simple_graph()["edges"],
            },
        },
    )
    assert creation.status_code == 201
    workflow_id = creation.json()["workflow_id"]

    version_response = client.post(
        f"/api/workflows/{workflow_id}/versions",
        headers=_auth_headers(token),
        json={"graph": _simple_graph(), "mark_as_active": True},
    )
    assert version_response.status_code == 201

    selection = client.post(
        "/api/workflows/chatkit",
        headers=_auth_headers(token),
        json={"workflow_id": workflow_id},
    )
    assert selection.status_code == 200
    payload = selection.json()
    assert payload["id"] == workflow_id
    assert payload["is_chatkit_default"] is True

    current = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert current.status_code == 200
    assert current.json()["workflow_id"] == workflow_id
    assert current.json()["workflow_is_chatkit_default"] is True


def test_chatkit_workflow_cannot_be_deleted() -> None:
    admin = _make_user(email="keeper@example.com", is_admin=True)
    token = create_access_token(admin)

    creation = client.post(
        "/api/workflows",
        headers=_auth_headers(token),
        json={
            "slug": "workflow-a-garder",
            "display_name": "Workflow à garder",
            "graph": {
                "nodes": _simple_graph()["nodes"],
                "edges": _simple_graph()["edges"],
            },
        },
    )
    workflow_id = creation.json()["workflow_id"]

    client.post(
        f"/api/workflows/{workflow_id}/versions",
        headers=_auth_headers(token),
        json={"graph": _simple_graph(), "mark_as_active": True},
    )

    client.post(
        "/api/workflows/chatkit",
        headers=_auth_headers(token),
        json={"workflow_id": workflow_id},
    )

    deletion = client.delete(
        f"/api/workflows/{workflow_id}",
        headers=_auth_headers(token),
    )

    assert deletion.status_code == 400
    assert "chatkit" in deletion.json()["detail"].lower()
