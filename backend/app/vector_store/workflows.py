"""Helpers for ingesting workflow blueprints alongside vector store documents."""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import Workflow
from ..schemas import VectorStoreWorkflowBlueprint
from ..workflows import (
    WorkflowDefinition,
    WorkflowService,
    WorkflowValidationError,
)


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    return normalized or None


def _ensure_mapping(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return value
    raise WorkflowValidationError(
        "Le blueprint du workflow doit contenir un graphe JSON valide."
    )


def ingest_workflow_blueprint(
    workflow_service: WorkflowService,
    *,
    session: Session,
    blueprint: VectorStoreWorkflowBlueprint,
) -> WorkflowDefinition:
    """Create or import a workflow definition from a vector store blueprint."""

    slug = (blueprint.slug or "").strip()
    if not slug:
        raise WorkflowValidationError("Le slug du workflow ne peut pas être vide.")

    display_name = (blueprint.display_name or "").strip()
    if not display_name:
        raise WorkflowValidationError(
            "Le nom du workflow ne peut pas être vide."
        )

    description = _normalize_optional_text(blueprint.description)
    graph_payload = _ensure_mapping(blueprint.graph)
    mark_active = bool(blueprint.mark_active)

    existing = session.scalar(select(Workflow).where(Workflow.slug == slug))
    if existing is not None:
        return workflow_service.import_workflow(
            graph_payload=graph_payload,
            session=session,
            workflow_id=existing.id,
            slug=slug,
            display_name=display_name,
            description=description,
            mark_as_active=mark_active,
        )

    try:
        return workflow_service.create_workflow(
            slug=slug,
            display_name=display_name,
            description=description,
            graph_payload=graph_payload,
            session=session,
        )
    except WorkflowValidationError as exc:
        message = getattr(exc, "message", str(exc)).lower()
        if "slug" not in message or "existe" not in message:
            raise
        return workflow_service.import_workflow(
            graph_payload=graph_payload,
            session=session,
            slug=slug,
            display_name=display_name,
            description=description,
            mark_as_active=mark_active,
        )
