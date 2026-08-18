"""Deterministic laboratory APIs, intentionally independent from workflows."""
from __future__ import annotations

import datetime
import json
from typing import Any

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sqlalchemy import desc, select

from ..chatkit_server.context import ChatKitRequestContext
from ..config import get_settings
from ..database import SessionLocal, get_session
from ..dependencies import get_current_user, require_admin
from ..labs import (
    LabService, available_markdown_sources, build_lab_attempt_docx, parse_lab_markdown, resolve_markdown_path,
    validate_slug,
)
from ..models import LabActivity, LabAttempt, LabVersion, LTIUserSession, User
from ..labs.storage import read_lab_package, resolve_local_asset_url, safe_asset_path, save_student_image, storage_root, stored_image_path
from ..labs.service import calculate_grade

router = APIRouter(prefix="/api/labs", tags=["labs"])


class LabSaveRequest(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)
    revision: int = Field(ge=0)


class LabExportRequest(BaseModel):
    answers: dict[str, Any] = Field(default_factory=dict)


class TeacherValidationRequest(BaseModel):
    field_id: str
    approved: bool = True
    comment: str | None = None


class GradeRequest(BaseModel):
    score: float = Field(ge=0)
    maximum: float = Field(default=100, gt=0)
    feedback: str | None = None
    publish_to_moodle: bool = False


class FieldGradeRequest(BaseModel):
    field_id: str
    rating: str
    comment: str | None = None


@router.post("/admin/attempts/{attempt_id}/generate-feedback")
async def generate_attempt_feedback(
    attempt_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentative introuvable")
    definition = LabService(session).version_for(attempt).definition
    fields = {field["id"]: field for field in definition.get("fields", [])}
    grades = attempt.payload.get("field_grades", {})
    summary = [{"champ": fields.get(field_id, {}).get("label", field_id),
                "réponse": attempt.payload.get("responses", {}).get(field_id),
                "évaluation": grade.get("rating"), "commentaire": grade.get("comment")}
               for field_id, grade in grades.items()]
    if not summary:
        raise HTTPException(409, "Corrigez au moins un champ avant de générer la rétroaction")
    settings = get_settings()
    if not settings.openai_api_key:
        raise HTTPException(409, "Aucune clé OpenAI n’est configurée")
    try:
        from openai import AsyncOpenAI
        client = AsyncOpenAI(api_key=settings.openai_api_key, base_url=settings.chatkit_api_base)
        response = await client.responses.create(
            model="gpt-5.6-luna",
            input=("Rédige en français canadien une rétroaction pédagogique concise et constructive pour l’étudiant. "
                   "Appuie-toi uniquement sur la correction fournie, souligne un point réussi, explique les améliorations prioritaires "
                   "et termine par une prochaine action concrète. N’invente aucune mesure. Ne mentionne pas le modèle IA.\n\n"
                   + json.dumps({"note": attempt.validated_score, "correction": summary}, ensure_ascii=False, default=str)),
        )
    except Exception as exc:
        raise HTTPException(502, f"Génération de la rétroaction impossible: {exc}") from exc
    feedback = response.output_text.strip()
    return {"feedback": feedback, "model": "gpt-5.6-luna"}


class LabCreateRequest(BaseModel):
    slug: str
    source_path: str
    description: str | None = None


class LabSourceRequest(BaseModel):
    source: str = Field(min_length=1, max_length=2_000_000)


def _attempt(session: Session, attempt_id: str, user: User) -> LabAttempt:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None or attempt.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Tentative introuvable")
    return attempt


def _attempt_payload(attempt: LabAttempt) -> dict[str, Any]:
    return {
        "id": attempt.id,
        "status": attempt.status,
        "revision": attempt.revision,
        "answers": attempt.payload.get("responses", {}),
        "started_at": attempt.started_at,
        "updated_at": attempt.updated_at,
        "submitted_at": attempt.submitted_at,
        "teacher_validations": attempt.payload.get("teacher_validations", {}),
        "feedback": attempt.payload.get("feedback"),
        "score": attempt.validated_score,
        "field_grades": attempt.payload.get("field_grades", {}),
        "version_migrations": attempt.payload.get("version_migrations", []),
    }


@router.get("/admin/catalog")
def lab_admin_catalog(
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    activities = session.scalars(select(LabActivity).order_by(LabActivity.title)).all()
    labs = []
    for activity in activities:
        version = LabService(session).latest_version(activity)
        attempt_count = session.query(LabAttempt).filter(LabAttempt.activity_id == activity.id).count()
        labs.append({"id": activity.id, "slug": activity.slug, "title": activity.title,
                     "description": activity.description, "source_path": activity.source_path,
                     "version": version.version if version else None,
                     "field_count": len(activity.definition.get("fields", [])),
                     "attempt_count": attempt_count})
    return {"labs": labs, "sources": available_markdown_sources()}


@router.post("/admin")
def create_lab(
    payload: LabCreateRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    slug = validate_slug(payload.slug)
    if session.scalar(select(LabActivity).where(LabActivity.slug == slug)) is not None:
        raise HTTPException(409, "Ce slug de laboratoire existe déjà")
    path = resolve_markdown_path(payload.source_path)
    activity = LabService(session).sync(slug=slug, source=path.read_text(encoding="utf-8"),
        description=payload.description or f"Source: {path.name}", source_path=str(path))
    version = LabService(session).latest_version(activity)
    return {"id": activity.id, "slug": activity.slug, "title": activity.title,
            "source_path": str(path), "version": version.version if version else None}


@router.post("/admin/upload")
async def upload_lab(
    slug: str = Form(...),
    description: str | None = Form(None),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    normalized_slug = validate_slug(slug)
    if session.scalar(select(LabActivity).where(LabActivity.slug == normalized_slug)) is not None:
        raise HTTPException(409, "Ce slug de laboratoire existe déjà")
    source, source_path = await read_lab_package(file, normalized_slug)
    try:
        parse_lab_markdown(source, slug=normalized_slug)
    except ValueError as exc:
        raise HTTPException(422, f"Markdown enrichi invalide: {exc}") from exc
    activity = LabService(session).sync(slug=normalized_slug, source=source,
        description=description or file.filename, source_path=source_path)
    version = LabService(session).latest_version(activity)
    return {"id": activity.id, "slug": activity.slug, "title": activity.title,
            "source_path": activity.source_path, "version": version.version if version else None}


@router.post("/admin/{activity_slug}/upload")
async def upload_new_lab_version(
    activity_slug: str,
    description: str | None = Form(None),
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    activity = LabService(session).get_activity(activity_slug)
    source, source_path = await read_lab_package(file, activity.slug)
    try:
        parse_lab_markdown(source, slug=activity.slug)
    except ValueError as exc:
        raise HTTPException(422, f"Markdown enrichi invalide: {exc}") from exc
    activity = LabService(session).sync(slug=activity.slug, source=source,
        description=description or activity.description, source_path=source_path)
    version = LabService(session).latest_version(activity)
    return {"slug": activity.slug, "title": activity.title,
            "source_path": activity.source_path, "version": version.version if version else None}


@router.post("/admin/{activity_slug}/sync")
def sync_lab_source(
    activity_slug: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    activity = LabService(session).get_activity(activity_slug)
    if not activity.source_path:
        raise HTTPException(409, "Aucune source Markdown n'est associée à ce laboratoire")
    if activity.source_path.startswith("upload://"):
        raise HTTPException(409, "Téléversez le Markdown modifié pour publier une nouvelle version")
    path = resolve_markdown_path(activity.source_path)
    source = path.read_text(encoding="utf-8")
    activity = LabService(session).sync(
        slug=activity_slug, source=source, description=activity.description,
        source_path=str(path),
    )
    version = LabService(session).latest_version(activity)
    return {"slug": activity.slug, "source_path": str(path), "version": version.version if version else None}


@router.get("/admin/{activity_slug}/versions")
def list_lab_versions(
    activity_slug: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    activity = LabService(session).get_activity(activity_slug)
    versions = session.scalars(select(LabVersion).where(
        LabVersion.activity_id == activity.id
    ).order_by(desc(LabVersion.version))).all()
    return [{"id": item.id, "version": item.version, "content_hash": item.content_hash,
             "created_at": item.created_at, "field_count": len(item.definition.get("fields", []))}
            for item in versions]


@router.get("/admin/{activity_slug}/editor")
def get_lab_editor_source(
    activity_slug: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    activity = LabService(session).get_activity(activity_slug)
    version = LabService(session).latest_version(activity)
    if version is None:
        raise HTTPException(409, "Laboratoire non publié")
    return {"source": version.source_markdown, "definition": version.definition, "version": version.version}


@router.post("/admin/{activity_slug}/editor")
def publish_lab_editor_source(
    activity_slug: str,
    payload: LabSourceRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    activity = LabService(session).get_activity(activity_slug)
    try:
        parse_lab_markdown(payload.source, slug=activity.slug)
    except ValueError as exc:
        raise HTTPException(422, f"Document invalide: {exc}") from exc
    activity = LabService(session).sync(slug=activity.slug, source=payload.source,
        description=activity.description, source_path="editor://visual")
    version = LabService(session).latest_version(activity)
    return {"slug": activity.slug, "title": activity.title, "version": version.version if version else None}


@router.post("/admin/{activity_slug}/assets")
async def upload_editor_asset(
    activity_slug: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, str]:
    activity = LabService(session).get_activity(activity_slug)
    metadata = await save_student_image(file, f"editor-{activity.slug}", "course")
    source = stored_image_path(str(metadata["storage_key"]))
    package_id = "editor"
    target_dir = storage_root() / "course" / activity.slug / package_id
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / source.name
    source.replace(target)
    return {"url": f"/api/labs/assets/{activity.slug}/{package_id}/{target.name}", "name": str(metadata["name"])}


@router.get("/admin/{activity_slug}/attempts")
def list_lab_attempts(
    activity_slug: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> list[dict[str, Any]]:
    activity = LabService(session).get_activity(activity_slug)
    rows = session.execute(select(LabAttempt, User, LabVersion).join(
        User, User.id == LabAttempt.user_id
    ).join(LabVersion, LabVersion.id == LabAttempt.version_id).where(
        LabAttempt.activity_id == activity.id
    ).order_by(desc(LabAttempt.updated_at))).all()
    return [{**_attempt_payload(attempt), "user": {"id": user.id, "email": user.email,
             "display_name": user.display_name}, "version": version.version,
             "answers": attempt.payload.get("responses", {}),
             "teacher_validation_fields": [
                 {"id": field["id"], "label": field["label"], "section": field.get("section")}
                 for field in version.definition.get("fields", [])
                 if field.get("type") == "teacher_validation"
             ], "response_fields": [field for field in version.definition.get("fields", []) if field.get("type") != "teacher_validation"]}
            for attempt, user, version in rows]


@router.post("/admin/attempts/{attempt_id}/field-grade")
def grade_attempt_field(
    attempt_id: str,
    payload: FieldGradeRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentative introuvable")
    definition = LabService(session).version_for(attempt).definition
    field_ids = {field["id"] for field in definition.get("fields", []) if field.get("type") != "teacher_validation"}
    if payload.field_id not in field_ids or payload.rating not in {"correct", "partial", "incorrect", "ungraded"}:
        raise HTTPException(422, "Évaluation de champ invalide")
    grades = dict(attempt.payload.get("field_grades", {}))
    grades[payload.field_id] = {"rating": payload.rating, "comment": payload.comment}
    attempt.validated_score = calculate_grade(definition, grades)
    attempt.payload = {**attempt.payload, "field_grades": grades, "score_maximum": 100}
    attempt.updated_at = datetime.datetime.now(datetime.UTC)
    return _attempt_payload(attempt)


@router.post("/admin/attempts/{attempt_id}/teacher-validation")
def validate_teacher_step(
    attempt_id: str,
    payload: TeacherValidationRequest,
    session: Session = Depends(get_session),
    admin: User = Depends(require_admin),
) -> dict[str, Any]:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentative introuvable")
    definition = LabService(session).version_for(attempt).definition
    teacher_ids = {field["id"] for field in definition["fields"] if field["type"] == "teacher_validation"}
    if payload.field_id not in teacher_ids:
        raise HTTPException(422, "Étape de validation inconnue")
    validations = dict(attempt.payload.get("teacher_validations", {}))
    validations[payload.field_id] = {"approved": payload.approved, "comment": payload.comment,
        "teacher_id": admin.id, "teacher_name": admin.display_name or admin.email,
        "validated_at": datetime.datetime.now(datetime.UTC).isoformat()}
    attempt.payload = {**attempt.payload, "teacher_validations": validations}
    attempt.updated_at = datetime.datetime.now(datetime.UTC)
    return _attempt_payload(attempt)


@router.post("/admin/attempts/{attempt_id}/reopen")
def reopen_attempt(
    attempt_id: str,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentative introuvable")
    attempt.status = "in_progress"
    attempt.submitted_at = None
    attempt.revision += 1
    return _attempt_payload(attempt)


@router.post("/admin/attempts/{attempt_id}/grade")
async def grade_attempt(
    attempt_id: str,
    payload: GradeRequest,
    session: Session = Depends(get_session),
    _admin: User = Depends(require_admin),
) -> dict[str, Any]:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None:
        raise HTTPException(404, "Tentative introuvable")
    definition = LabService(session).version_for(attempt).definition
    field_grades = attempt.payload.get("field_grades", {})
    attempt.validated_score = calculate_grade(definition, field_grades) if field_grades else payload.score
    attempt.status = "evaluated"
    attempt.payload = {**attempt.payload, "feedback": payload.feedback,
                       "score_maximum": payload.maximum, "ags_status": "not_requested"}
    if payload.publish_to_moodle:
        # Lazy import avoids the existing ChatKit/AGS module cycle at app startup.
        from ..lti.ags import LTIAGSClient

        lti_session = session.scalar(select(LTIUserSession).where(
            LTIUserSession.user_id == attempt.user_id,
            LTIUserSession.resource_link_id == attempt.resource_link_id,
        ).order_by(desc(LTIUserSession.launched_at)).limit(1))
        if lti_session is None or not lti_session.platform_user_id:
            raise HTTPException(409, "Aucun contexte Moodle AGS associé à cette tentative")
        resource = lti_session.resource_link
        context = ChatKitRequestContext(
            user_id=str(attempt.user_id), email=None, is_lti_user=True,
            lti_session_id=lti_session.id, lti_registration_id=lti_session.registration_id,
            lti_deployment_id=lti_session.deployment_id,
            lti_resource_link_id=lti_session.resource_link_id,
            lti_resource_link_ref=resource.resource_link_id if resource else None,
            lti_platform_user_id=lti_session.platform_user_id,
            lti_platform_context_id=lti_session.platform_context_id,
            ags_line_items_endpoint=lti_session.ags_line_items_endpoint,
            ags_line_item_endpoint=lti_session.ags_line_item_endpoint,
            ags_scopes=tuple(lti_session.ags_scopes or []),
            ags_default_score_maximum=payload.maximum,
            ags_default_label="Laboratoire",
        )
        variable_id = f"lab-{attempt.activity_id}"
        client = LTIAGSClient(settings=get_settings(), session_factory=SessionLocal)
        line_item = await client.ensure_line_item(context=context, variable_id=variable_id,
            max_score=payload.maximum, comment=payload.feedback)
        await client.publish_score(context=context, line_item_id=line_item or variable_id,
            variable_id=variable_id, score=payload.score, max_score=payload.maximum)
        attempt.payload = {**attempt.payload, "ags_status": "published"}
    return _attempt_payload(attempt)


@router.get("")
def list_labs(
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> list[dict[str, Any]]:
    activities = session.scalars(select(LabActivity).order_by(LabActivity.title)).all()
    return [{"id": item.id, "slug": item.slug, "title": item.title, "description": item.description} for item in activities]


@router.get("/assets/{activity_slug}/{package_id}/{asset_path:path}")
def get_lab_asset(activity_slug: str, package_id: str, asset_path: str) -> FileResponse:
    return FileResponse(safe_asset_path(validate_slug(activity_slug), package_id, asset_path))


@router.get("/{activity_slug}")
def get_lab(
    activity_slug: str,
    session: Session = Depends(get_session),
    _user: User = Depends(get_current_user),
) -> dict[str, Any]:
    activity = LabService(session).get_activity(activity_slug)
    return {
        "id": activity.id, "slug": activity.slug, "title": activity.title,
        "description": activity.description, "definition": activity.definition,
    }


@router.post("/{activity_slug}/attempt")
def start_or_resume_lab(
    activity_slug: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    service = LabService(session)
    activity = service.get_activity(activity_slug)
    attempt = service.get_or_create_attempt(activity, user)
    return {"activity": {"slug": activity.slug, "title": activity.title, "definition": activity.definition}, "attempt": _attempt_payload(attempt)}


@router.patch("/attempts/{attempt_id}")
def save_lab(
    attempt_id: str,
    payload: LabSaveRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    attempt = _attempt(session, attempt_id, user)
    LabService(session).save(attempt, payload.answers, payload.revision)
    return _attempt_payload(attempt)


@router.post("/attempts/{attempt_id}/images/{field_id}")
async def upload_attempt_image(
    attempt_id: str,
    field_id: str,
    file: UploadFile = File(...),
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    attempt = _attempt(session, attempt_id, user)
    if attempt.status != "in_progress":
        raise HTTPException(409, "Cette tentative est verrouillée")
    definition = LabService(session).version_for(attempt).definition
    fields = {field["id"]: field for field in definition.get("fields", [])}
    if field_id not in fields or fields[field_id].get("type") != "image":
        raise HTTPException(422, "Champ image inconnu")
    metadata = await save_student_image(file, attempt.id, field_id)
    return {"image": metadata}


@router.get("/attempts/{attempt_id}/images/{image_id}")
def get_attempt_image(
    attempt_id: str,
    image_id: str,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> FileResponse:
    attempt = session.get(LabAttempt, attempt_id)
    if attempt is None or (attempt.user_id != user.id and not user.is_admin):
        raise HTTPException(404, "Image introuvable")
    for value in attempt.payload.get("responses", {}).values():
        if isinstance(value, dict) and value.get("id") == image_id and value.get("storage_key"):
            return FileResponse(stored_image_path(value["storage_key"]), media_type=value.get("content_type"), filename=value.get("name"))
    directory = storage_root() / "student" / attempt_id
    pending = list(directory.glob(f"{image_id}.*")) if directory.is_dir() else []
    if len(pending) == 1:
        return FileResponse(pending[0])
    raise HTTPException(404, "Image introuvable")


@router.post("/attempts/{attempt_id}/submit")
def submit_lab(
    attempt_id: str,
    payload: LabSaveRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> dict[str, Any]:
    attempt = _attempt(session, attempt_id, user)
    LabService(session).submit(attempt, payload.answers, payload.revision)
    return _attempt_payload(attempt)


@router.post("/attempts/{attempt_id}/export.docx")
def export_lab_attempt(
    attempt_id: str,
    payload: LabExportRequest,
    session: Session = Depends(get_session),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    attempt = _attempt(session, attempt_id, user)
    service = LabService(session)
    version = service.version_for(attempt)
    current = service.validate_answers(version.definition, payload.answers, final=False)
    answers = {**attempt.payload.get("responses", {}), **current}
    activity = session.get(LabActivity, attempt.activity_id)
    content = build_lab_attempt_docx(
        title=activity.title if activity else "Laboratoire",
        student_name=user.display_name or user.email,
        definition=version.definition,
        answers=answers,
        validations=attempt.payload.get("teacher_validations", {}),
        status=attempt.status,
        updated_at=attempt.updated_at,
        image_resolver=lambda value: stored_image_path(value) if value.startswith("student/") else resolve_local_asset_url(value),
    )
    filename = f"{activity.slug if activity else 'laboratoire'}-copie.docx"
    return StreamingResponse(
        iter([content]),
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
