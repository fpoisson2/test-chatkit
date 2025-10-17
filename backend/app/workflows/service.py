from __future__ import annotations

import datetime
import logging
from dataclasses import dataclass
from typing import Any, Callable, Iterable, Mapping

from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from ..database import SessionLocal
from ..models import Workflow, WorkflowDefinition, WorkflowStep, WorkflowTransition

logger = logging.getLogger(__name__)

DEFAULT_END_MESSAGE = "Workflow terminé"

_TRUTHY_AUTO_START_VALUES = {"true", "1", "yes", "on"}
_FALSY_AUTO_START_VALUES = {"false", "0", "no", "off"}


def _coerce_auto_start(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return False
        if normalized in _TRUTHY_AUTO_START_VALUES:
            return True
        if normalized in _FALSY_AUTO_START_VALUES:
            return False
        return False
    if isinstance(value, (int, float)):
        return value != 0
    return False


def resolve_start_auto_start(
    definition: "WorkflowDefinition",
) -> bool:
    """Retourne l'option de démarrage automatique du bloc début."""

    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        parameters = step.parameters
        if isinstance(parameters, Mapping):
            raw_value = parameters.get("auto_start")
            if raw_value is None:
                raw_value = parameters.get("start_automatically")
            return _coerce_auto_start(raw_value)
        break

    return False


def resolve_start_auto_start_message(
    definition: "WorkflowDefinition",
) -> str:
    """Retourne le message utilisateur injecté lors du démarrage automatique."""

    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        parameters = step.parameters
        if isinstance(parameters, Mapping):
            raw_message = parameters.get("auto_start_user_message")
            if isinstance(raw_message, str):
                return raw_message
        break

    return ""


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
            "parameters": {
                "message": DEFAULT_END_MESSAGE,
                "status": {"type": "closed", "reason": DEFAULT_END_MESSAGE},
            },
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
        {"source": "collecte-web", "target": "validation", "metadata": {"label": ""}},
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

MINIMAL_WORKFLOW_GRAPH: dict[str, Any] = {
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
            "slug": "end",
            "kind": "end",
            "display_name": "Fin",
            "is_enabled": True,
            "parameters": {
                "message": DEFAULT_END_MESSAGE,
                "status": {"type": "closed", "reason": DEFAULT_END_MESSAGE},
            },
            "metadata": {"position": {"x": 320, "y": 0}},
        },
    ],
    "edges": [
        {"source": "start", "target": "end", "metadata": {"label": ""}},
    ],
}

DEFAULT_WORKFLOW_SLUG = "workflow-par-defaut"
DEFAULT_WORKFLOW_DISPLAY_NAME = "Workflow par défaut"


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


class WorkflowNotFoundError(LookupError):
    """Signale qu'un workflow n'a pas pu être localisé."""

    def __init__(self, workflow_id: int) -> None:
        super().__init__(f"Workflow introuvable ({workflow_id})")
        self.workflow_id = workflow_id


class WorkflowVersionNotFoundError(LookupError):
    """Signale qu'une version de workflow est introuvable."""

    def __init__(self, workflow_id: int, version_id: int) -> None:
        super().__init__(f"Version {version_id} introuvable pour le workflow {workflow_id}")
        self.workflow_id = workflow_id
        self.version_id = version_id


class WorkflowService:
    """Gestionnaire de persistance pour la configuration du workflow."""

    def __init__(self, session_factory: Callable[[], Session] | None = None) -> None:
        self._session_factory = session_factory or SessionLocal

    def _fully_load_definition(
        self, definition: WorkflowDefinition
    ) -> WorkflowDefinition:
        """Charge toutes les relations nécessaires avant fermeture de session."""

        definition.steps  # noqa: B018 - charge les étapes liées
        transitions = list(definition.transitions)  # noqa: B018 - charge les transitions
        for transition in transitions:
            transition.source_step  # noqa: B018 - charge le nœud source
            transition.target_step  # noqa: B018 - charge le nœud cible
        definition.workflow  # noqa: B018 - charge le workflow parent
        return definition

    def _get_session(self, session: Session | None) -> tuple[Session, bool]:
        if session is not None:
            return session, False
        return self._session_factory(), True

    def _get_or_create_default_workflow(self, session: Session) -> Workflow:
        workflow = session.scalar(
            select(Workflow).where(Workflow.slug == DEFAULT_WORKFLOW_SLUG)
        )
        if workflow is None:
            existing = session.scalar(select(Workflow).order_by(Workflow.created_at.asc()))
            if existing is not None:
                workflow = existing
                workflow.slug = DEFAULT_WORKFLOW_SLUG
                if not workflow.display_name:
                    workflow.display_name = DEFAULT_WORKFLOW_DISPLAY_NAME
                session.flush()
            else:
                workflow = Workflow(slug=DEFAULT_WORKFLOW_SLUG, display_name=DEFAULT_WORKFLOW_DISPLAY_NAME)
                session.add(workflow)
                session.flush()
        return workflow

    def _ensure_default_workflow(self, session: Session) -> Workflow:
        workflow = self._get_or_create_default_workflow(session)
        definition = self._load_active_definition(workflow, session)
        if definition is None:
            self._create_default_definition(session, workflow)
            session.commit()
            session.refresh(workflow)

        has_chatkit_default = session.scalar(
            select(Workflow.id).where(Workflow.is_chatkit_default.is_(True))
        )
        if has_chatkit_default is None:
            workflow.is_chatkit_default = True
            session.add(workflow)
            session.commit()
            session.refresh(workflow)
        return workflow

    def _get_chatkit_workflow(self, session: Session) -> Workflow:
        workflow = session.scalar(
            select(Workflow).where(Workflow.is_chatkit_default.is_(True))
        )
        if workflow is None:
            workflow = self._ensure_default_workflow(session)
        return workflow

    def _load_active_definition(self, workflow: Workflow, session: Session) -> WorkflowDefinition | None:
        definition = session.scalar(
            select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.workflow_id == workflow.id,
                    WorkflowDefinition.is_active.is_(True),
                )
                .order_by(WorkflowDefinition.updated_at.desc())
        )
        if definition is not None:
            return definition
        return session.scalar(
            select(WorkflowDefinition)
            .where(WorkflowDefinition.workflow_id == workflow.id)
            .order_by(WorkflowDefinition.updated_at.desc())
        )

    def _get_next_version(self, workflow: Workflow, session: Session) -> int:
        current = session.scalar(
            select(func.max(WorkflowDefinition.version)).where(
                WorkflowDefinition.workflow_id == workflow.id
            )
        )
        return int(current or 0) + 1

    def _set_active_definition(
        self, workflow: Workflow, definition: WorkflowDefinition, session: Session
    ) -> None:
        session.execute(
            update(WorkflowDefinition)
            .where(
                WorkflowDefinition.workflow_id == workflow.id,
                WorkflowDefinition.id != definition.id,
            )
            .values(is_active=False)
        )
        definition.is_active = True
        workflow.active_version_id = definition.id
        session.flush()

    def _replace_definition_graph(
        self,
        definition: WorkflowDefinition,
        *,
        nodes: list[NormalizedNode],
        edges: list[NormalizedEdge],
        session: Session,
    ) -> WorkflowDefinition:
        definition.transitions[:] = []
        session.flush()
        definition.steps[:] = []
        session.flush()

        slug_to_step: dict[str, WorkflowStep] = {}
        for index, node in enumerate(nodes, start=1):
            step = WorkflowStep(
                slug=node.slug,
                kind=node.kind,
                display_name=node.display_name,
                agent_key=node.agent_key,
                position=index,
                is_enabled=node.is_enabled,
                parameters=dict(node.parameters),
                ui_metadata=dict(node.metadata),
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

        session.flush()
        return definition

    def _create_definition_from_graph(
        self,
        *,
        workflow: Workflow,
        nodes: list[NormalizedNode],
        edges: list[NormalizedEdge],
        session: Session,
        name: str | None = None,
        mark_active: bool = False,
    ) -> WorkflowDefinition:
        version_number = self._get_next_version(workflow, session)
        definition = WorkflowDefinition(
            workflow=workflow,
            name=name or f"v{version_number}",
            version=version_number,
            is_active=False,
        )
        session.add(definition)
        session.flush()

        self._replace_definition_graph(
            definition,
            nodes=nodes,
            edges=edges,
            session=session,
        )
        if mark_active:
            self._set_active_definition(workflow, definition, session)

        return definition

    def get_current(self, session: Session | None = None) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            workflow = self._get_chatkit_workflow(db)
            definition = self._load_active_definition(workflow, db)
            if definition is None:
                definition = self._create_default_definition(db, workflow)
                db.commit()
                db.refresh(definition)
            definition = self._fully_load_definition(definition)
            if self._needs_graph_backfill(definition):
                logger.info(
                    "Legacy workflow detected, backfilling default graph with existing agent configuration",
                )
                definition = self._backfill_legacy_definition(definition, db)
                self._set_active_definition(workflow, definition, db)
                db.commit()
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
            normalized_nodes, normalized_edges = self._normalize_graph(graph_payload)
            workflow = self._get_chatkit_workflow(db)
            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=normalized_nodes,
                edges=normalized_edges,
                session=db,
                mark_active=True,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def _create_default_definition(self, session: Session, workflow: Workflow) -> WorkflowDefinition:
        nodes, edges = self._normalize_graph(DEFAULT_WORKFLOW_GRAPH)
        definition = self._create_definition_from_graph(
            workflow=workflow,
            nodes=nodes,
            edges=edges,
            session=session,
            name="Version initiale",
            mark_active=True,
        )
        session.commit()
        session.refresh(definition)
        return self._fully_load_definition(definition)

    def list_workflows(self, session: Session | None = None) -> list[Workflow]:
        db, owns_session = self._get_session(session)
        try:
            self._ensure_default_workflow(db)
            workflows = db.scalars(select(Workflow).order_by(Workflow.created_at.asc())).all()
            for workflow in workflows:
                workflow.versions  # force le chargement des versions
            return workflows
        finally:
            if owns_session:
                db.close()

    def set_chatkit_workflow(
        self, workflow_id: int, session: Session | None = None
    ) -> Workflow:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            if workflow.active_version_id is None:
                raise WorkflowValidationError(
                    "Définissez une version de production avant d'utiliser ce workflow avec ChatKit."
                )

            has_changed = False
            workflows = db.scalars(select(Workflow)).all()
            for current in workflows:
                should_be_default = current.id == workflow_id
                if current.is_chatkit_default != should_be_default:
                    current.is_chatkit_default = should_be_default
                    has_changed = True
                    db.add(current)

            if has_changed:
                db.commit()
                db.refresh(workflow)
            workflow.versions
            return workflow
        finally:
            if owns_session:
                db.close()

    def get_workflow(self, workflow_id: int, session: Session | None = None) -> Workflow:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            workflow.versions
            return workflow
        finally:
            if owns_session:
                db.close()

    def list_versions(
        self, workflow_id: int, session: Session | None = None
    ) -> list[WorkflowDefinition]:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            definitions = db.scalars(
                select(WorkflowDefinition)
                .where(WorkflowDefinition.workflow_id == workflow_id)
                .order_by(WorkflowDefinition.version.desc())
            ).all()
            for definition in definitions:
                definition.steps
            return definitions
        finally:
            if owns_session:
                db.close()

    def get_version(
        self, workflow_id: int, version_id: int, session: Session | None = None
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def create_workflow(
        self,
        *,
        slug: str,
        display_name: str,
        description: str | None = None,
        graph_payload: dict[str, Any] | None = None,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            existing = db.scalar(select(Workflow).where(Workflow.slug == slug))
            if existing is not None:
                raise WorkflowValidationError("Un workflow avec ce slug existe déjà.")
            workflow = Workflow(slug=slug, display_name=display_name, description=description)
            db.add(workflow)
            db.flush()

            nodes, edges = self._normalize_graph(graph_payload, allow_empty=True)

            mark_active = bool(graph_payload and (graph_payload.get("nodes") or []))

            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name="Version initiale",
                mark_active=mark_active,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def delete_workflow(
        self, workflow_id: int, *, session: Session | None = None
    ) -> None:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            if workflow.slug == DEFAULT_WORKFLOW_SLUG or workflow.is_chatkit_default:
                raise WorkflowValidationError(
                    "Le workflow sélectionné pour ChatKit ne peut pas être supprimé."
                )
            db.delete(workflow)
            db.commit()
        finally:
            if owns_session:
                db.close()

    def create_version(
        self,
        workflow_id: int,
        graph_payload: dict[str, Any],
        *,
        name: str | None = None,
        mark_as_active: bool = False,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            nodes, edges = self._normalize_graph(graph_payload)
            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name=name,
                mark_active=mark_as_active,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def update_version(
        self,
        workflow_id: int,
        version_id: int,
        graph_payload: dict[str, Any],
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
                .options(
                    selectinload(WorkflowDefinition.workflow),
                    selectinload(WorkflowDefinition.steps),
                    selectinload(WorkflowDefinition.transitions),
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            nodes, edges = self._normalize_graph(graph_payload)
            if definition.is_active:
                # Lorsqu'une version active est modifiée, on crée une nouvelle version
                # brouillon pour conserver l'historique de la version de production.
                draft = self._create_definition_from_graph(
                    workflow=definition.workflow,
                    nodes=nodes,
                    edges=edges,
                    session=db,
                    name=definition.name,
                    mark_active=False,
                )
                db.commit()
                db.refresh(draft)
                return self._fully_load_definition(draft)

            self._replace_definition_graph(
                definition,
                nodes=nodes,
                edges=edges,
                session=db,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def set_production_version(
        self,
        workflow_id: int,
        version_id: int,
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            workflow = definition.workflow or db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            self._set_active_definition(workflow, definition, db)
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def _needs_graph_backfill(self, definition: WorkflowDefinition) -> bool:
        has_start = any(step.kind == "start" for step in definition.steps)
        has_edges = bool(definition.transitions)
        if not (has_start and has_edges):
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
        return self._fully_load_definition(definition)

    def _normalize_graph(
        self,
        payload: dict[str, Any] | None,
        *,
        allow_empty: bool = False,
    ) -> tuple[list[NormalizedNode], list[NormalizedEdge]]:
        if not payload:
            if allow_empty:
                return self._build_minimal_graph()
            raise WorkflowValidationError("Le workflow doit contenir un graphe valide.")

        raw_nodes = payload.get("nodes") or []
        raw_edges = payload.get("edges") or []
        if not raw_nodes:
            if allow_empty:
                if raw_edges:
                    raise WorkflowValidationError(
                        "Impossible de définir des connexions sans nœuds."
                    )
                return self._build_minimal_graph()
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
            if kind not in {
                "start",
                "agent",
                "condition",
                "state",
                "json_vector_store",
                "widget",
                "end",
            }:
                raise WorkflowValidationError(f"Type de nœud invalide : {kind or 'inconnu'}")

            agent_key: str | None = None
            if kind == "agent":
                raw_agent_key = entry.get("agent_key")
                if raw_agent_key is None:
                    agent_key = None
                elif isinstance(raw_agent_key, str):
                    trimmed_key = raw_agent_key.strip()
                    if trimmed_key:
                        if trimmed_key not in SUPPORTED_AGENT_KEYS:
                            raise WorkflowValidationError(
                                f"Agent inconnu : {trimmed_key}"
                            )
                        agent_key = trimmed_key
                else:
                    raise WorkflowValidationError(
                        f"Le nœud agent {slug} possède une clé d'agent invalide."
                    )

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

        minimal_skeleton = self._is_minimal_skeleton(normalized_nodes, normalized_edges)
        has_enabled_widget = any(
            node.kind == "widget" and node.is_enabled for node in normalized_nodes
        )
        if not (
            enabled_agent_slugs
            or has_enabled_widget
            or allow_empty
            or minimal_skeleton
        ):
            raise WorkflowValidationError(
                "Le workflow doit activer au moins un agent ou un widget."
            )
        # Les anciens workflows imposaient la présence d'un rédacteur final, mais la
        # bibliothèque permet désormais de créer des workflows plus simples.
        # Nous conservons uniquement la vérification d'au moins un agent actif.

        self._validate_graph_structure(normalized_nodes, normalized_edges)
        return normalized_nodes, normalized_edges

    def _build_minimal_graph(self) -> tuple[list[NormalizedNode], list[NormalizedEdge]]:
        nodes = [
            NormalizedNode(
                slug=str(entry["slug"]),
                kind=str(entry["kind"]),
                display_name=str(entry.get("display_name") or "") or None,
                agent_key=None,
                is_enabled=bool(entry.get("is_enabled", True)),
                parameters=dict(entry.get("parameters") or {}),
                metadata=dict(entry.get("metadata") or {}),
            )
            for entry in MINIMAL_WORKFLOW_GRAPH["nodes"]
        ]
        edges = [
            NormalizedEdge(
                source_slug=str(entry.get("source", "")),
                target_slug=str(entry.get("target", "")),
                condition=None,
                metadata=dict(entry.get("metadata") or {}),
            )
            for entry in MINIMAL_WORKFLOW_GRAPH["edges"]
        ]
        return nodes, edges

    def _is_minimal_skeleton(
        self,
        nodes: Iterable[NormalizedNode],
        edges: Iterable[NormalizedEdge],
    ) -> bool:
        enabled_nodes = [node for node in nodes if node.is_enabled]
        if not enabled_nodes:
            return False

        start_nodes = [node for node in enabled_nodes if node.kind == "start"]
        end_nodes = [node for node in enabled_nodes if node.kind == "end"]
        if len(start_nodes) != 1:
            return False

        # Autorise uniquement le couple Début / Fin comme nœuds actifs.
        if len(enabled_nodes) > 2:
            return False

        start_slug = start_nodes[0].slug
        if not end_nodes:
            return all(edge.source_slug != start_slug for edge in edges)

        end_slug = end_nodes[0].slug

        for edge in edges:
            if edge.source_slug == start_slug and edge.target_slug == end_slug:
                return True
        return False

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

        for end_slug in end_nodes:
            if end_slug not in visited:
                raise WorkflowValidationError(
                    f"Le nœud de fin {end_slug} n'est pas accessible depuis le début du workflow."
                )

        reachable_terminals = [slug for slug in visited if not adjacency.get(slug)]
        if not reachable_terminals:
            raise WorkflowValidationError(
                "Le workflow doit comporter au moins une sortie accessible sans transition."
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
        "workflow_id": definition.workflow_id,
        "workflow_slug": definition.workflow.slug if definition.workflow else None,
        "workflow_display_name": definition.workflow.display_name if definition.workflow else None,
        "workflow_is_chatkit_default": bool(
            definition.workflow and definition.workflow.is_chatkit_default
        ),
        "name": definition.name,
        "version": definition.version,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
        "steps": agent_steps,
        "graph": {"nodes": nodes_payload, "edges": edges_payload},
    }


def serialize_workflow_summary(workflow: Workflow) -> dict[str, Any]:
    active_version = workflow.active_version
    return {
        "id": workflow.id,
        "slug": workflow.slug,
        "display_name": workflow.display_name,
        "description": workflow.description,
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at,
        "active_version_id": workflow.active_version_id,
        "active_version_number": active_version.version if active_version else None,
        "is_chatkit_default": workflow.is_chatkit_default,
        "versions_count": len(workflow.versions),
    }


def serialize_version_summary(definition: WorkflowDefinition) -> dict[str, Any]:
    return {
        "id": definition.id,
        "workflow_id": definition.workflow_id,
        "name": definition.name,
        "version": definition.version,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
    }
