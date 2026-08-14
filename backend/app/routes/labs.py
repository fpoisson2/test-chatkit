"""API des activités de laboratoire structurées.

La première version expose un contrat persistant léger dans la colonne JSON de
la table dédiée. La correction IA réelle peut ensuite être remplacée par le
runner configuré dans le builder sans modifier le contrat frontend.
"""
from __future__ import annotations

import datetime
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import get_current_user
from ..models import LabActivity, LabAttempt, User, Workflow, WorkflowDefinition

router = APIRouter(prefix="/api/labs", tags=["labs"])


class LabSaveRequest(BaseModel):
    responses: dict[str, str] = Field(default_factory=dict)
    attachments: list[dict[str, Any]] = Field(default_factory=list)


class LabSubmitRequest(LabSaveRequest):
    pass


class LabValidateRequest(BaseModel):
    score: float = Field(ge=0, le=100)
    feedback: str = ""


def _activity_or_404(session: Session, activity_id: str) -> LabActivity:
    activity = session.scalar(select(LabActivity).where(LabActivity.slug == activity_id))
    if not activity:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Laboratoire introuvable")
    return activity


def _attempt_or_404(session: Session, attempt_id: str, user: User) -> LabAttempt:
    attempt = session.scalar(select(LabAttempt).where(LabAttempt.id == attempt_id, LabAttempt.user_id == user.id))
    if not attempt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tentative introuvable")
    return attempt


@router.get("/{activity_id}")
def get_lab(activity_id: str, session: Session = Depends(get_session), _user: User = Depends(get_current_user)):
    activity = _activity_or_404(session, activity_id)
    return {"id": activity.slug, **activity.definition}


@router.get("/workflow/{workflow_slug}")
def get_lab_from_workflow(workflow_slug: str, session: Session = Depends(get_session), _user: User = Depends(get_current_user)):
    workflow = session.scalar(select(Workflow).where(Workflow.slug == workflow_slug))
    if not workflow or not workflow.active_version_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Workflow laboratoire introuvable")
    definition = session.scalar(select(WorkflowDefinition).where(WorkflowDefinition.id == workflow.active_version_id))
    lab_step = next((step for step in (definition.steps if definition else []) if step.kind == "lab"), None)
    if not lab_step:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Aucun bloc laboratoire configuré")
    return {"id": workflow.slug, "title": workflow.display_name, "courseName": workflow.description or "Activité Moodle", "durationSeconds": int(lab_step.parameters.get("duration_minutes", 180)) * 60, "introduction": lab_step.parameters.get("introduction", ""), "sections": lab_step.parameters.get("sections", []), "criteria": lab_step.parameters.get("criteria", []), "adaptiveQuestionsEnabled": bool(lab_step.parameters.get("adaptive_questions_enabled", True)), "maxAdaptiveQuestions": int(lab_step.parameters.get("max_adaptive_questions", 2)), "allowRevision": bool(lab_step.parameters.get("allow_revision", True))}


@router.post("/{activity_id}/attempt")
def start_or_resume_lab(activity_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    activity = _activity_or_404(session, activity_id)
    attempt = session.scalar(select(LabAttempt).where(LabAttempt.activity_id == activity.id, LabAttempt.user_id == user.id, LabAttempt.status.in_(["in_progress", "revision_requested"])).order_by(LabAttempt.created_at.desc()))
    if not attempt:
        now = datetime.datetime.now(datetime.UTC)
        attempt = LabAttempt(id=str(uuid.uuid4()), activity_id=activity.id, user_id=user.id, started_at=now, created_at=now, updated_at=now, status="in_progress", payload={"responses": {}, "attachments": [], "feedback": []})
        session.add(attempt)
        session.commit()
    return {"id": attempt.id, "activity_id": activity.slug, "started_at": attempt.started_at, "status": attempt.status, **attempt.payload}


@router.patch("/attempts/{attempt_id}")
def save_lab(attempt_id: str, payload: LabSaveRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    attempt = _attempt_or_404(session, attempt_id, user)
    if attempt.status in {"validated", "expired"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette copie est verrouillée")
    attempt.payload = {**attempt.payload, "responses": payload.responses, "attachments": payload.attachments}
    attempt.updated_at = datetime.datetime.now(datetime.UTC)
    session.commit()
    return {"saved_at": attempt.updated_at, "status": attempt.status}


@router.post("/attempts/{attempt_id}/submit")
def submit_lab(attempt_id: str, payload: LabSubmitRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    attempt = _attempt_or_404(session, attempt_id, user)
    if attempt.status in {"validated", "expired"}:
        raise HTTPException(status.HTTP_409_CONFLICT, "Cette copie est verrouillée")
    attempt.payload = {**attempt.payload, "responses": payload.responses, "attachments": payload.attachments, "feedback": [{"author": "IA", "message": "Proposition générée selon les critères du laboratoire."}]}
    attempt.status = "submitted"
    attempt.submitted_at = datetime.datetime.now(datetime.UTC)
    attempt.updated_at = attempt.submitted_at
    session.commit()
    return {"status": attempt.status, "proposed_score": attempt.payload.get("proposed_score", 0), "feedback": attempt.payload["feedback"]}


@router.post("/attempts/{attempt_id}/revision")
def request_revision(attempt_id: str, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    attempt = _attempt_or_404(session, attempt_id, user)
    if attempt.status != "submitted":
        raise HTTPException(status.HTTP_409_CONFLICT, "La révision n’est pas disponible dans cet état")
    attempt.status = "revision_requested"
    attempt.updated_at = datetime.datetime.now(datetime.UTC)
    session.commit()
    return {"status": attempt.status}


@router.post("/attempts/{attempt_id}/validate")
def validate_lab(attempt_id: str, payload: LabValidateRequest, session: Session = Depends(get_session), user: User = Depends(get_current_user)):
    if not user.is_admin:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Validation réservée aux enseignants")
    attempt = session.get(LabAttempt, attempt_id)
    if not attempt:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tentative introuvable")
    attempt.status = "validated"
    attempt.validated_score = payload.score
    attempt.payload = {**attempt.payload, "teacher_feedback": payload.feedback}
    attempt.updated_at = datetime.datetime.now(datetime.UTC)
    session.commit()
    return {"status": attempt.status, "score": attempt.validated_score, "moodle_publication": "pending_ags"}
