from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass
from typing import Any, Callable, Iterable

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import WorkflowDefinition, WorkflowStep, WorkflowTransition

logger = logging.getLogger(__name__)

SUPPORTED_AGENT_KEYS: set[str] = {
    "triage",
    "get_data_from_web",
    "triage_2",
    "get_data_from_user",
    "r_dacteur",
}

EXPECTED_STATE_SLUGS: set[str] = {
    "maj-etat-triage",
    "maj-etat-validation",
}

DEFAULT_AGENT_SLUGS: set[str] = {
    "analyse",
    "collecte-web",
    "validation",
    "collecte-utilisateur",
    "finalisation",
}

DEFAULT_WORKFLOW_GRAPH: dict[str, Any] = {
    "nodes": [
        {
            "slug": "start",
            "kind": "start",
            "display_name": "Début",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 0, "y": 0}},
        },
        {
            "slug": "analyse",
            "kind": "agent",
            "agent_key": "triage",
            "display_name": "Analyse des informations",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 240, "y": 0}},
        },
        {
            "slug": "maj-etat-triage",
            "kind": "state",
            "display_name": "Mise à jour de l'état (analyse)",
            "is_enabled": True,
            "parameters": {
                "state": [
                    {
                        "target": "state.has_all_details",
                        "expression": "input.output_parsed.has_all_details",
                    },
                    {
                        "target": "state.infos_manquantes",
                        "expression": "input.output_text",
                    },
                    {
                        "target": "state.should_finalize",
                        "expression": "input.output_parsed.has_all_details",
                    },
                ]
            },
            "metadata": {"position": {"x": 370, "y": -80}},
        },
        {
            "slug": "infos-completes",
            "kind": "condition",
            "display_name": "Toutes les informations?",
            "is_enabled": True,
            "parameters": {
                "mode": "truthy",
                "path": "has_all_details",
            },
            "metadata": {"position": {"x": 500, "y": 0}},
        },
        {
            "slug": "collecte-web",
            "kind": "agent",
            "agent_key": "get_data_from_web",
            "display_name": "Collecte web",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 500, "y": 180}},
        },
        {
            "slug": "validation",
            "kind": "agent",
            "agent_key": "triage_2",
            "display_name": "Validation",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 760, "y": 180}},
        },
        {
            "slug": "maj-etat-validation",
            "kind": "state",
            "display_name": "Mise à jour de l'état (validation)",
            "is_enabled": True,
            "parameters": {
                "state": [
                    {
                        "target": "state.has_all_details",
                        "expression": "input.output_parsed.has_all_details",
                    },
                    {
                        "target": "state.infos_manquantes",
                        "expression": "input.output_text",
                    },
                    {
                        "target": "state.should_finalize",
                        "expression": "input.output_parsed.has_all_details",
                    },
                ]
            },
            "metadata": {"position": {"x": 900, "y": 120}},
        },
        {
            "slug": "pret-final",
            "kind": "condition",
            "display_name": "Prêt pour finalisation?",
            "is_enabled": True,
            "parameters": {
                "mode": "truthy",
                "path": "should_finalize",
            },
            "metadata": {"position": {"x": 1020, "y": 180}},
        },
        {
            "slug": "collecte-utilisateur",
            "kind": "agent",
            "agent_key": "get_data_from_user",
            "display_name": "Collecte utilisateur",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 1020, "y": 340}},
        },
        {
            "slug": "finalisation",
            "kind": "agent",
            "agent_key": "r_dacteur",
            "display_name": "Rédaction",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 1300, "y": 0}},
        },
        {
            "slug": "end",
            "kind": "end",
            "display_name": "Fin",
            "is_enabled": True,
            "parameters": {},
            "metadata": {"position": {"x": 1550, "y": 0}},
        },
    ],
    "edges": [
        {"source": "start", "target": "analyse", "metadata": {"label": ""}},
        {"source": "analyse", "target": "maj-etat-triage", "metadata": {"label": ""}},
        {
            "source": "maj-etat-triage",
            "target": "infos-completes",
            "metadata": {"label": ""},
        },
        {
            "source": "infos-completes",
            "target": "finalisation",
            "condition": "true",
            "metadata": {"label": "Oui"},
        },
        {
            "source": "infos-completes",
            "target": "collecte-web",
            "condition": "false",
            "metadata": {"label": "Non"},
        },
        {
            "source": "collecte-web",
            "target": "validation",
            "metadata": {"label": ""},
        },
        {
            "source": "validation",
            "target": "maj-etat-validation",
            "metadata": {"label": ""},
        },
        {
            "source": "maj-etat-validation",
            "target": "pret-final",
            "metadata": {"label": ""},
        },
        {
            "source": "pret-final",
            "target": "finalisation",
            "condition": "true",
            "metadata": {"label": "Oui"},
        },
        {
            "source": "pret-final",
            "target": "collecte-utilisateur",
            "condition": "false",
            "metadata": {"label": "Non"},
        },
        {
            "source": "collecte-utilisateur",
            "target": "finalisation",
            "metadata": {"label": ""},
        },
        {"source": "finalisation", "target": "end", "metadata": {"label": ""}},
    ],
}

DEFAULT_WORKFLOW_NAME = "workflow-par-defaut"


@dataclass(slots=True, frozen=True)
class NormalizedNode:
    slug: str
    kind: str
    display_name: str | None
    agent_key: str | None
    is_enabled: bool
    parameters: dict[str, Any]
    metadata: dict[str, Any]


@dataclass(slots=True, frozen=True)
class NormalizedEdge:
    source_slug: str
    target_slug: str
    condition: str | None
    metadata: dict[str, Any]


class WorkflowValidationError(ValueError):
    """Exception de validation pour la configuration du workflow."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class WorkflowService:
    """Gestionnaire de persistance pour la configuration du workflow."""

    def __init__(self, session_factory: Callable[[], Session] | None = None) -> None:
        self._session_factory = session_factory or SessionLocal

    def _get_session(self, session: Session | None) -> tuple[Session, bool]:
        if session is not None:
            return session, False
        return self._session_factory(), True

    def get_current(self, session: Session | None = None) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition)
                .where(WorkflowDefinition.is_active.is_(True))
                .order_by(WorkflowDefinition.updated_at.desc())
            )
            if definition is None:
                definition = self._create_default_definition(db)
            definition.steps  # noqa: B018 - charge les étapes
            definition.transitions  # noqa: B018 - charge les transitions
            if self._needs_graph_backfill(definition):
                logger.info(
                    "Legacy workflow detected, backfilling default graph with existing agent configuration",
                )
                definition = self._backfill_legacy_definition(definition, db)
            return definition
        finally:
            if owns_session:
                db.close()

    def update_current(
        self,
        graph_payload: dict[str, Any],
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = self.get_current(db)
            normalized_nodes, normalized_edges = self._normalize_graph(graph_payload)
            definition.transitions.clear()
            definition.steps.clear()
            db.flush()

            slug_to_step: dict[str, WorkflowStep] = {}
            for index, node in enumerate(normalized_nodes, start=1):
                step = WorkflowStep(
                    slug=node.slug,
                    kind=node.kind,
                    display_name=node.display_name,
                    agent_key=node.agent_key,
                    position=index,
                    is_enabled=node.is_enabled,
                    parameters=node.parameters,
                    ui_metadata=node.metadata,
                )
                definition.steps.append(step)
                slug_to_step[node.slug] = step

            for edge in normalized_edges:
                source = slug_to_step[edge.source_slug]
                target = slug_to_step[edge.target_slug]
                definition.transitions.append(
                    WorkflowTransition(
                        source_step=source,
                        target_step=target,
                        condition=edge.condition,
                        ui_metadata=edge.metadata,
                    )
                )

            definition.updated_at = datetime.datetime.now(datetime.UTC)
            db.add(definition)
            db.commit()
            db.refresh(definition)
            definition.steps  # noqa: B018
            definition.transitions  # noqa: B018
            return definition
        finally:
            if owns_session:
                db.close()

    def _create_default_definition(self, session: Session) -> WorkflowDefinition:
        definition = WorkflowDefinition(name=DEFAULT_WORKFLOW_NAME, is_active=True)
        session.add(definition)
        session.flush()
        nodes, edges = self._normalize_graph(DEFAULT_WORKFLOW_GRAPH)
        slug_to_step: dict[str, WorkflowStep] = {}
        for index, node in enumerate(nodes, start=1):
            step = WorkflowStep(
                slug=node.slug,
                kind=node.kind,
                display_name=node.display_name,
                agent_key=node.agent_key,
                position=index,
                is_enabled=node.is_enabled,
                parameters=node.parameters,
                ui_metadata=node.metadata,
            )
            definition.steps.append(step)
            slug_to_step[node.slug] = step

        for edge in edges:
            definition.transitions.append(
                WorkflowTransition(
                    source_step=slug_to_step[edge.source_slug],
                    target_step=slug_to_step[edge.target_slug],
                    condition=edge.condition,
                    ui_metadata=edge.metadata,
                )
            )

        session.commit()
        session.refresh(definition)
        definition.steps  # noqa: B018
        definition.transitions  # noqa: B018
        return definition

    def _needs_graph_backfill(self, definition: WorkflowDefinition) -> bool:
        has_start = any(step.kind == "start" for step in definition.steps)
        has_end = any(step.kind == "end" for step in definition.steps)
        has_edges = bool(definition.transitions)
        if not (has_start and has_end and has_edges):
            return True

        existing_slugs = {step.slug for step in definition.steps}
        if EXPECTED_STATE_SLUGS.issubset(existing_slugs):
            return False

        if DEFAULT_AGENT_SLUGS.issubset(existing_slugs):
            return True

        return False

    def _backfill_legacy_definition(
        self, definition: WorkflowDefinition, session: Session
    ) -> WorkflowDefinition:
        legacy_agent_steps: dict[str, WorkflowStep] = {}
        for step in definition.steps:
            if step.agent_key:
                legacy_agent_steps.setdefault(step.agent_key, step)

        definition.transitions.clear()
        definition.steps.clear()
        session.flush()

        nodes, edges = self._normalize_graph(DEFAULT_WORKFLOW_GRAPH)
        slug_to_step: dict[str, WorkflowStep] = {}

        for index, node in enumerate(nodes, start=1):
            display_name = node.display_name
            is_enabled = node.is_enabled
            parameters = dict(node.parameters)
            metadata = dict(node.metadata)

            if node.kind == "agent" and node.agent_key:
                legacy_step = legacy_agent_steps.get(node.agent_key)
                if legacy_step is not None:
                    if legacy_step.display_name:
                        display_name = legacy_step.display_name
                    is_enabled = legacy_step.is_enabled
                    parameters = dict(legacy_step.parameters or {})
                    metadata = dict(legacy_step.ui_metadata or metadata)

            step = WorkflowStep(
                slug=node.slug,
                kind=node.kind,
                display_name=display_name,
                agent_key=node.agent_key,
                position=index,
                is_enabled=is_enabled,
                parameters=parameters,
                ui_metadata=metadata,
            )
            definition.steps.append(step)
            slug_to_step[node.slug] = step

        for edge in edges:
            definition.transitions.append(
                WorkflowTransition(
                    source_step=slug_to_step[edge.source_slug],
                    target_step=slug_to_step[edge.target_slug],
                    condition=edge.condition,
                    ui_metadata=dict(edge.metadata),
                )
            )

        definition.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(definition)
        session.commit()
        session.refresh(definition)
        definition.steps  # noqa: B018
        definition.transitions  # noqa: B018
        return definition

    def _normalize_graph(
        self, payload: dict[str, Any] | None
    ) -> tuple[list[NormalizedNode], list[NormalizedEdge]]:
        if not payload:
            raise WorkflowValidationError("Le workflow doit contenir un graphe valide.")

        raw_nodes = payload.get("nodes") or []
        raw_edges = payload.get("edges") or []
        if not raw_nodes:
            raise WorkflowValidationError("Le workflow doit contenir au moins un nœud.")

        normalized_nodes: list[NormalizedNode] = []
        slugs: set[str] = set()
        enabled_agent_slugs: set[str] = set()
        enabled_agent_keys: set[str] = set()

        for entry in raw_nodes:
            if not isinstance(entry, dict):
                raise WorkflowValidationError("Chaque nœud doit être un objet JSON.")

            slug = str(entry.get("slug", "")).strip()
            if not slug:
                raise WorkflowValidationError("Chaque nœud doit posséder un identifiant (slug).")
            if slug in slugs:
                raise WorkflowValidationError(f"Slug dupliqué détecté : {slug}")
            slugs.add(slug)

            kind = str(entry.get("kind", "")).strip().lower()
            if kind not in {"start", "agent", "condition", "state", "end"}:
                raise WorkflowValidationError(f"Type de nœud invalide : {kind or 'inconnu'}")

            agent_key: str | None = entry.get("agent_key")
            if kind == "agent":
                if not agent_key or not isinstance(agent_key, str):
                    raise WorkflowValidationError(
                        f"Le nœud agent {slug} doit préciser un agent supporté."
                    )
                if agent_key not in SUPPORTED_AGENT_KEYS:
                    raise WorkflowValidationError(f"Agent inconnu : {agent_key}")
            else:
                agent_key = None

            display_name_raw = entry.get("display_name")
            display_name = (
                str(display_name_raw)
                if display_name_raw is not None and str(display_name_raw).strip()
                else None
            )

            is_enabled = bool(entry.get("is_enabled", True))

            parameters = self._ensure_dict(entry.get("parameters"), "paramètres")
            metadata = self._ensure_dict(entry.get("metadata"), "métadonnées")

            node = NormalizedNode(
                slug=slug,
                kind=kind,
                display_name=display_name,
                agent_key=agent_key,
                is_enabled=is_enabled,
                parameters=parameters,
                metadata=metadata,
            )
            normalized_nodes.append(node)

            if node.kind == "agent" and node.is_enabled:
                enabled_agent_slugs.add(node.slug)
                if node.agent_key:
                    enabled_agent_keys.add(node.agent_key)

        if not any(node.kind == "start" and node.is_enabled for node in normalized_nodes):
            raise WorkflowValidationError("Le workflow doit contenir un nœud de début actif.")
        if not any(node.kind == "end" and node.is_enabled for node in normalized_nodes):
            raise WorkflowValidationError("Le workflow doit contenir un nœud de fin actif.")
        if not enabled_agent_slugs:
            raise WorkflowValidationError("Au moins un agent doit être actif dans le workflow.")
        if "r_dacteur" not in enabled_agent_keys:
            raise WorkflowValidationError("Le workflow doit contenir une étape r_dacteur active.")

        normalized_edges: list[NormalizedEdge] = []
        for entry in raw_edges:
            if not isinstance(entry, dict):
                raise WorkflowValidationError("Chaque connexion doit être un objet JSON.")
            source_slug = str(entry.get("source", "")).strip()
            target_slug = str(entry.get("target", "")).strip()
            if not source_slug or not target_slug:
                raise WorkflowValidationError("Chaque connexion doit préciser source et cible.")
            if source_slug not in slugs:
                raise WorkflowValidationError(f"Connexion inconnue : source {source_slug} absente")
            if target_slug not in slugs:
                raise WorkflowValidationError(f"Connexion inconnue : cible {target_slug} absente")

            condition_raw = entry.get("condition")
            condition = str(condition_raw).strip().lower() if condition_raw else None
            if condition == "":
                condition = None

            metadata = self._ensure_dict(entry.get("metadata"), "métadonnées")

            normalized_edges.append(
                NormalizedEdge(
                    source_slug=source_slug,
                    target_slug=target_slug,
                    condition=condition,
                    metadata=metadata,
                )
            )

        self._validate_graph_structure(normalized_nodes, normalized_edges)
        return normalized_nodes, normalized_edges

    def _ensure_dict(self, value: Any, label: str) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, dict):
            return value
        raise WorkflowValidationError(f"Les {label} doivent être un objet JSON.")

    def _validate_graph_structure(
        self, nodes: Iterable[NormalizedNode], edges: Iterable[NormalizedEdge]
    ) -> None:
        nodes_by_slug = {node.slug: node for node in nodes if node.is_enabled}
        if not nodes_by_slug:
            raise WorkflowValidationError("Le workflow doit conserver au moins un nœud actif.")

        adjacency: dict[str, list[NormalizedEdge]] = {slug: [] for slug in nodes_by_slug}
        reverse_adjacency: dict[str, list[NormalizedEdge]] = {slug: [] for slug in nodes_by_slug}
        for edge in edges:
            if edge.source_slug not in nodes_by_slug or edge.target_slug not in nodes_by_slug:
                # Ignore edges reliant un nœud désactivé
                continue
            adjacency[edge.source_slug].append(edge)
            reverse_adjacency[edge.target_slug].append(edge)

        start_nodes = [slug for slug, node in nodes_by_slug.items() if node.kind == "start"]
        if not start_nodes:
            raise WorkflowValidationError("Impossible d'identifier le nœud de début actif.")
        if len(start_nodes) > 1:
            raise WorkflowValidationError(
                "Un seul nœud de début actif est autorisé dans le workflow."
            )

        end_nodes = [slug for slug, node in nodes_by_slug.items() if node.kind == "end"]
        if len(end_nodes) != 1:
            raise WorkflowValidationError("Le workflow doit contenir exactement un nœud de fin actif.")

        for slug, node in nodes_by_slug.items():
            outgoing = adjacency.get(slug, [])
            incoming = reverse_adjacency.get(slug, [])
            if node.kind == "start" and incoming:
                raise WorkflowValidationError("Le nœud de début ne doit pas avoir d'entrée.")
            if node.kind == "end" and outgoing:
                raise WorkflowValidationError("Le nœud de fin ne doit pas avoir de sortie.")
            if node.kind == "condition":
                conditions = {edge.condition or "default" for edge in outgoing}
                if "true" not in conditions or "false" not in conditions:
                    raise WorkflowValidationError(
                        f"Le nœud conditionnel {slug} doit exposer des branches true et false."
                    )

        visited: set[str] = set()
        stack: set[str] = set()

        def dfs(slug: str) -> None:
            if slug in stack:
                raise WorkflowValidationError(
                    "Une boucle a été détectée dans la configuration du workflow."
                )
            if slug in visited:
                return
            stack.add(slug)
            for edge in adjacency.get(slug, []):
                dfs(edge.target_slug)
            stack.remove(slug)
            visited.add(slug)

        dfs(start_nodes[0])

        end_slug = end_nodes[0]
        if end_slug not in visited:
            raise WorkflowValidationError(
                "Le nœud de fin n'est pas accessible depuis le début du workflow."
            )


def serialize_definition(definition: WorkflowDefinition) -> dict[str, Any]:
    """Convertit un objet SQLAlchemy en dictionnaire API-friendly."""

    nodes_payload = [
        {
            "id": step.id,
            "slug": step.slug,
            "kind": step.kind,
            "display_name": step.display_name,
            "agent_key": step.agent_key,
            "position": step.position,
            "is_enabled": step.is_enabled,
            "parameters": dict(step.parameters or {}),
            "metadata": dict(step.ui_metadata or {}),
            "created_at": step.created_at,
            "updated_at": step.updated_at,
        }
        for step in sorted(definition.steps, key=lambda s: s.position)
    ]

    edges_payload = [
        {
            "id": edge.id,
            "source": edge.source_step.slug,
            "target": edge.target_step.slug,
            "condition": edge.condition,
            "metadata": dict(edge.ui_metadata or {}),
            "created_at": edge.created_at,
            "updated_at": edge.updated_at,
        }
        for edge in definition.transitions
    ]

    agent_steps = [
        {
            "id": step.id,
            "agent_key": step.agent_key,
            "position": step.position,
            "is_enabled": step.is_enabled,
            "parameters": dict(step.parameters or {}),
            "created_at": step.created_at,
            "updated_at": step.updated_at,
        }
        for step in sorted(definition.steps, key=lambda s: s.position)
        if step.kind == "agent"
    ]

    return {
        "id": definition.id,
        "name": definition.name,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
        "steps": agent_steps,
        "graph": {"nodes": nodes_payload, "edges": edges_payload},
    }
