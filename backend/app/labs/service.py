from __future__ import annotations

import datetime
import uuid
from decimal import Decimal, InvalidOperation
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from ..models import LabActivity, LabAttempt, LabVersion, LTIUserSession, User
from .parser import parse_lab_markdown


def calculate_grade(definition: dict[str, Any], grades: dict[str, Any]) -> float:
    fields = [field for field in definition.get("fields", []) if field.get("type") != "teacher_validation"]
    explicit = [float(field.get("points", 0)) for field in fields]
    weights = explicit if any(explicit) else ([100 / len(fields)] * len(fields) if fields else [])
    if any(explicit):
        total = sum(weights) or 1
        weights = [weight / total * 100 for weight in weights]
    factors = {"correct": 1.0, "partial": 0.5, "incorrect": 0.0, "ungraded": 0.0}
    return round(sum(weight * factors.get(str(grades.get(field["id"], {}).get("rating", "ungraded")), 0) for field, weight in zip(fields, weights)), 2)


class LabService:
    """Deterministic laboratory lifecycle, independent from workflows/ChatKit."""

    def __init__(self, session: Session):
        self.session = session

    def sync(self, *, slug: str, source: str, description: str | None = None,
             source_path: str | None = None) -> LabActivity:
        definition = parse_lab_markdown(source, slug=slug)
        activity = self.session.scalar(select(LabActivity).where(LabActivity.slug == slug))
        if activity is None:
            activity = LabActivity(slug=slug, title=definition["title"], definition=definition)
            self.session.add(activity)
            self.session.flush()
        latest = self.latest_version(activity)
        existing = self.session.scalar(select(LabVersion).where(
            LabVersion.activity_id == activity.id,
            LabVersion.content_hash == definition["content_hash"],
        ))
        if latest is None:
            self.session.add(LabVersion(
                activity_id=activity.id, version=1,
                content_hash=definition["content_hash"], source_markdown=source,
                definition=definition,
            ))
        elif latest.content_hash != definition["content_hash"] and existing is None:
            self.session.add(LabVersion(
                activity_id=activity.id, version=latest.version + 1,
                content_hash=definition["content_hash"], source_markdown=source,
                definition=definition,
            ))
        activity.title = definition["title"]
        activity.description = description
        if source_path is not None:
            activity.source_path = source_path
        activity.definition = definition
        self.session.flush()
        return activity

    def get_activity(self, slug: str) -> LabActivity:
        activity = self.session.scalar(select(LabActivity).where(LabActivity.slug == slug))
        if activity is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Laboratoire introuvable")
        return activity

    def latest_version(self, activity: LabActivity) -> LabVersion | None:
        query = select(LabVersion).where(LabVersion.activity_id == activity.id)
        current_hash = (activity.definition or {}).get("content_hash")
        if current_hash:
            current = self.session.scalar(query.where(LabVersion.content_hash == current_hash))
            if current is not None:
                return current
        return self.session.scalar(query.order_by(desc(LabVersion.version)).limit(1))

    def _resource_link_id(self, user: User, activity: LabActivity) -> int | None:
        lti_session = self.session.scalar(select(LTIUserSession).where(
            LTIUserSession.user_id == user.id
        ).order_by(desc(LTIUserSession.launched_at)).limit(1))
        if not lti_session or not lti_session.resource_link:
            return None
        if lti_session.resource_link.lab_activity_id != activity.id:
            return None
        return lti_session.resource_link_id

    def get_or_create_attempt(self, activity: LabActivity, user: User) -> LabAttempt:
        version = self.latest_version(activity)
        if version is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Laboratoire non publié")
        resource_link_id = self._resource_link_id(user, activity)
        query = select(LabAttempt).where(
            LabAttempt.activity_id == activity.id, LabAttempt.user_id == user.id,
            LabAttempt.resource_link_id == resource_link_id
            if resource_link_id is not None else LabAttempt.resource_link_id.is_(None),
        ).order_by(desc(LabAttempt.created_at))
        attempt = self.session.scalar(query)
        if attempt is None:
            now = datetime.datetime.now(datetime.UTC)
            attempt = LabAttempt(
                id=str(uuid.uuid4()), activity_id=activity.id, version_id=version.id,
                resource_link_id=resource_link_id, user_id=user.id, started_at=now,
                created_at=now, updated_at=now, status="in_progress", revision=0,
                payload={"responses": {}, "attachments": []},
            )
            self.session.add(attempt)
            self.session.flush()
        elif attempt.status == "in_progress" and attempt.version_id != version.id:
            old_version = self.version_for(attempt)
            old_responses = dict(attempt.payload.get("responses", {}))
            compatible_ids = {field["id"] for field in version.definition["fields"]}
            retained = {key: value for key, value in old_responses.items() if key in compatible_ids}
            archived = {key: value for key, value in old_responses.items() if key not in compatible_ids}
            history = list(attempt.payload.get("version_migrations", []))
            history.append({
                "from_version": old_version.version,
                "to_version": version.version,
                "migrated_at": datetime.datetime.now(datetime.UTC).isoformat(),
                "retained_fields": sorted(retained),
                "archived_responses": archived,
            })
            attempt.version_id = version.id
            attempt.payload = {**attempt.payload, "responses": retained, "version_migrations": history}
            attempt.revision += 1
            attempt.updated_at = datetime.datetime.now(datetime.UTC)
            self.session.flush()
        return attempt

    def version_for(self, attempt: LabAttempt) -> LabVersion:
        version = self.session.get(LabVersion, attempt.version_id)
        if version is None:
            raise HTTPException(status.HTTP_409_CONFLICT, "Version du laboratoire introuvable")
        return version

    def validate_answers(self, definition: dict[str, Any], answers: dict[str, Any], *, final: bool) -> dict[str, Any]:
        fields = {field["id"]: field for field in definition["fields"]}
        unknown = set(answers) - set(fields)
        if unknown:
            raise HTTPException(422, f"Champs inconnus: {', '.join(sorted(unknown))}")
        normalized: dict[str, Any] = {}
        for field_id, value in answers.items():
            field = fields[field_id]
            kind = field["type"]
            if kind == "number" and value not in (None, ""):
                try:
                    normalized[field_id] = float(Decimal(str(value).replace(",", ".")))
                except (InvalidOperation, ValueError):
                    raise HTTPException(422, f"{field['label']}: nombre invalide") from None
            elif kind == "checkbox":
                if not isinstance(value, bool):
                    raise HTTPException(422, f"{field['label']}: booléen attendu")
                normalized[field_id] = value
            elif kind in {"radio", "select"} and value not in (None, ""):
                if value not in {option["id"] for option in field["options"]}:
                    raise HTTPException(422, f"{field['label']}: choix invalide")
                normalized[field_id] = value
            elif kind in {"table", "matrix"}:
                if not isinstance(value, dict):
                    raise HTTPException(422, f"{field['label']}: objet attendu")
                allowed = {f"{row['id']}.{column['id']}" for row in field["rows"] for column in field["columns"]}
                if set(value) - allowed:
                    raise HTTPException(422, f"{field['label']}: cellule inconnue")
                columns = {column["id"]: column for column in field["columns"]}
                normalized_cells: dict[str, Any] = {}
                for key, cell in value.items():
                    column = columns[key.split(".", 1)[1]]
                    if column.get("input_type") == "number" and cell not in (None, ""):
                        try:
                            normalized_cells[key] = float(Decimal(str(cell).replace(",", ".")))
                        except (InvalidOperation, ValueError):
                            raise HTTPException(422, f"{field['label']}: nombre invalide dans {key}") from None
                    elif column.get("input_type") == "select" and cell not in (None, ""):
                        if str(cell) not in column.get("options", []):
                            raise HTTPException(422, f"{field['label']}: choix invalide dans {key}")
                        normalized_cells[key] = str(cell)
                    else:
                        normalized_cells[key] = str(cell) if cell is not None else ""
                normalized[field_id] = normalized_cells
            elif kind == "image":
                if value in (None, ""):
                    normalized[field_id] = None
                elif not isinstance(value, dict) or not isinstance(value.get("id"), str):
                    raise HTTPException(422, f"{field['label']}: image invalide")
                else:
                    normalized[field_id] = {key: value.get(key) for key in ("id", "field_id", "name", "content_type", "size", "storage_key")}
            elif value is None or isinstance(value, str):
                normalized[field_id] = value
            else:
                raise HTTPException(422, f"{field['label']}: valeur invalide")
        if final:
            missing: list[str] = []
            for field in fields.values():
                if not field.get("required") or field["type"] == "teacher_validation":
                    continue
                value = normalized.get(field["id"])
                if value in (None, "", {}):
                    missing.append(field["id"])
                    continue
                if field["type"] in {"table", "matrix"}:
                    editable_columns = [column for column in field["columns"] if column.get("input_type") != "readonly"]
                    visible = set(field.get("visible_columns", []))
                    if visible:
                        editable_columns = [column for column in editable_columns if column["id"] in visible]
                    expected = {f"{row['id']}.{column['id']}" for row in field["rows"] for column in editable_columns}
                    if any(value.get(key) in (None, "") for key in expected):
                        missing.append(field["id"])
            if missing:
                raise HTTPException(422, f"Champs obligatoires manquants: {', '.join(missing)}")
        return normalized

    def save(self, attempt: LabAttempt, answers: dict[str, Any], revision: int) -> LabAttempt:
        if attempt.status != "in_progress":
            raise HTTPException(status.HTTP_409_CONFLICT, "Cette tentative est verrouillée")
        if revision != attempt.revision:
            raise HTTPException(status.HTTP_409_CONFLICT, "Révision périmée; rechargez la tentative")
        validated = self.validate_answers(self.version_for(attempt).definition, answers, final=False)
        attempt.payload = {**attempt.payload, "responses": {**attempt.payload.get("responses", {}), **validated}}
        attempt.revision += 1
        attempt.updated_at = datetime.datetime.now(datetime.UTC)
        self.session.flush()
        return attempt

    def submit(self, attempt: LabAttempt, answers: dict[str, Any], revision: int) -> LabAttempt:
        self.save(attempt, answers, revision)
        attempt.payload = {**attempt.payload, "responses": self.validate_answers(
            self.version_for(attempt).definition, attempt.payload.get("responses", {}), final=True
        )}
        attempt.status = "submitted"
        attempt.submitted_at = datetime.datetime.now(datetime.UTC)
        attempt.updated_at = attempt.submitted_at
        self.session.flush()
        return attempt
