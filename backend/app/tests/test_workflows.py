from __future__ import annotations

import atexit
import os

from backend.app.config import get_settings

get_settings.cache_clear()

from fastapi.testclient import TestClient

from backend.app import app
from backend.app.database import SessionLocal, engine
from backend.app.models import (
    Base,
    User,
    WorkflowDefinition,
    WorkflowStep,
    WorkflowTransition,
)
from backend.app.security import create_access_token, hash_password

_db_path = engine.url.database or ""

Base.metadata.drop_all(bind=engine)
Base.metadata.create_all(bind=engine)

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


def test_get_workflow_requires_authentication() -> None:
    response = client.get("/api/workflows/current")
    assert response.status_code == 401


def test_get_workflow_requires_admin() -> None:
    user = _make_user(email="user@example.com", is_admin=False)
    token = create_access_token(user)
    response = client.get("/api/workflows/current", headers=_auth_headers(token))
    assert response.status_code == 403


def test_admin_can_read_default_graph() -> None:
    admin = _make_user(email="admin@example.com", is_admin=True)
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
    assert {
        "maj-etat-triage",
        "maj-etat-collecte-web",
        "maj-etat-validation",
        "maj-etat-collecte-utilisateur",
    }.issubset(state_slugs)
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

        definition = WorkflowDefinition(name="ancien-workflow", is_active=True)
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

        definition = WorkflowDefinition(name="workflow-sans-etat", is_active=True)
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
    assert {
        "maj-etat-triage",
        "maj-etat-collecte-web",
        "maj-etat-validation",
        "maj-etat-collecte-utilisateur",
    }.issubset(state_slugs)

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
