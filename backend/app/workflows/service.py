from __future__ import annotations

import datetime
from dataclasses import dataclass
from typing import Any, Callable, Sequence

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import WorkflowDefinition, WorkflowStep

SUPPORTED_AGENT_KEYS: set[str] = {
    "triage",
    "get_data_from_web",
    "triage_2",
    "get_data_from_user",
    "r_dacteur",
}

DEFAULT_WORKFLOW_STEPS: tuple[dict[str, Any], ...] = (
    {"agent_key": "triage", "is_enabled": True, "parameters": {}},
    {"agent_key": "get_data_from_web", "is_enabled": True, "parameters": {}},
    {"agent_key": "triage_2", "is_enabled": True, "parameters": {}},
    {"agent_key": "get_data_from_user", "is_enabled": True, "parameters": {}},
    {"agent_key": "r_dacteur", "is_enabled": True, "parameters": {}},
)

DEFAULT_WORKFLOW_NAME = "workflow-par-defaut"


@dataclass(slots=True, frozen=True)
class NormalizedStep:
    agent_key: str
    is_enabled: bool
    parameters: dict[str, Any]


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
            return definition
        finally:
            if owns_session:
                db.close()

    def update_current(
        self,
        steps: Sequence[dict[str, Any]],
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = self.get_current(db)
            normalized = self._normalize_steps(steps)
            definition.steps.clear()
            db.flush()
            for index, step in enumerate(normalized, start=1):
                definition.steps.append(
                    WorkflowStep(
                        agent_key=step.agent_key,
                        position=index,
                        is_enabled=step.is_enabled,
                        parameters=step.parameters,
                    )
                )
            definition.updated_at = datetime.datetime.now(datetime.UTC)
            db.add(definition)
            db.commit()
            db.refresh(definition)
            return definition
        finally:
            if owns_session:
                db.close()

    def _create_default_definition(self, session: Session) -> WorkflowDefinition:
        definition = WorkflowDefinition(name=DEFAULT_WORKFLOW_NAME, is_active=True)
        session.add(definition)
        session.flush()
        for index, config in enumerate(DEFAULT_WORKFLOW_STEPS, start=1):
            parameters = dict(config.get("parameters") or {})
            definition.steps.append(
                WorkflowStep(
                    agent_key=config["agent_key"],
                    position=index,
                    is_enabled=bool(config.get("is_enabled", True)),
                    parameters=parameters,
                )
            )
        session.commit()
        session.refresh(definition)
        return definition

    def _normalize_steps(self, raw_steps: Sequence[dict[str, Any]]) -> list[NormalizedStep]:
        if not raw_steps:
            raise WorkflowValidationError("Le workflow doit contenir au moins une étape.")

        def ensure_dict(value: Any) -> dict[str, Any]:
            if value is None:
                return {}
            if isinstance(value, dict):
                return value
            raise WorkflowValidationError("Les paramètres doivent être un objet JSON.")

        sorted_steps = sorted(raw_steps, key=lambda step: step.get("position", 0))
        normalized: list[NormalizedStep] = []
        enabled_agents: set[str] = set()

        for entry in sorted_steps:
            agent_key = str(entry.get("agent_key", "")).strip()
            if not agent_key:
                raise WorkflowValidationError("Chaque étape doit préciser un agent.")
            if agent_key not in SUPPORTED_AGENT_KEYS:
                raise WorkflowValidationError(f"Agent inconnu : {agent_key}")

            is_enabled = bool(entry.get("is_enabled", True))
            params = ensure_dict(entry.get("parameters"))
            normalized.append(
                NormalizedStep(agent_key=agent_key, is_enabled=is_enabled, parameters=params)
            )
            if is_enabled:
                enabled_agents.add(agent_key)

        if not any(step.is_enabled for step in normalized):
            raise WorkflowValidationError("Au moins une étape doit être active.")
        if "r_dacteur" not in enabled_agents:
            raise WorkflowValidationError("Le workflow doit contenir une étape r_dacteur active.")

        return normalized


def serialize_definition(definition: WorkflowDefinition) -> dict[str, Any]:
    """Convertit un objet SQLAlchemy en dictionnaire API-friendly."""
    return {
        "id": definition.id,
        "name": definition.name,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
        "steps": [
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
        ],
    }
