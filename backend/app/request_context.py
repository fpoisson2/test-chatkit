from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import Request
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from .chatkit import ChatKitRequestContext
from .database import SessionLocal
from .models import LTIResourceLink, LTIUserSession


def build_chatkit_request_context(
    current_user,
    request: Request | None = None,
    *,
    public_base_url: str | None = None,
    authorization: str | None = None,
    session: Session | None = None,
) -> ChatKitRequestContext:
    """Construct a :class:`ChatKitRequestContext` for the given user."""

    base_url = (
        public_base_url
        if public_base_url is not None
        else (resolve_public_base_url_from_request(request) if request else None)
    )
    if authorization is None and request is not None:
        authorization = request.headers.get("Authorization")

    lti_context = _resolve_lti_context(current_user, session=session)
    lti_kwargs: dict[str, Any] = {}
    if lti_context:
        lti_kwargs = {
            "lti_session_id": lti_context.get("session_id"),
            "lti_registration_id": lti_context.get("registration_id"),
            "lti_deployment_id": lti_context.get("deployment_id"),
            "lti_resource_link_id": lti_context.get("resource_link_id"),
            "lti_resource_link_ref": lti_context.get("resource_link_ref"),
            "lti_platform_user_id": lti_context.get("platform_user_id"),
            "lti_platform_context_id": lti_context.get("platform_context_id"),
            "ags_line_items_endpoint": lti_context.get("line_items_endpoint"),
            "ags_line_item_endpoint": lti_context.get("line_item_endpoint"),
            "ags_scopes": lti_context.get("scopes"),
            "ags_default_score_maximum": lti_context.get("default_score_maximum"),
            "ags_default_label": lti_context.get("default_label"),
        }

    return ChatKitRequestContext(
        user_id=str(getattr(current_user, "id", None) or ""),
        email=getattr(current_user, "email", None),
        authorization=authorization,
        public_base_url=base_url,
        **lti_kwargs,
    )


def _resolve_lti_context(
    current_user,
    *,
    session: Session | None = None,
) -> dict[str, object] | None:
    email = getattr(current_user, "email", None)
    if not isinstance(email, str) or not email.endswith("@lti.local"):
        return None

    user_id = getattr(current_user, "id", None)
    try:
        user_pk = int(user_id)
    except (TypeError, ValueError):
        return None

    owns_session = False
    db_session: Session
    if session is not None:
        db_session = session
    else:
        db_session = SessionLocal()
        owns_session = True

    try:
        stmt = (
            select(LTIUserSession)
            .where(LTIUserSession.user_id == user_pk)
            .order_by(desc(LTIUserSession.launched_at))
            .limit(1)
        )
        record = db_session.scalar(stmt)
        if record is None:
            return None

        resource_link_ref: str | None = None
        if record.resource_link_id is not None:
            resource_link_ref = db_session.scalar(
                select(LTIResourceLink.resource_link_id).where(
                    LTIResourceLink.id == record.resource_link_id
                )
            )

        scopes: tuple[str, ...] | None = None
        if record.ags_scopes:
            scopes = tuple(
                scope for scope in record.ags_scopes if isinstance(scope, str) and scope
            )

        default_score_maximum: float | None = None
        default_label: str | None = None
        claim_payload = record.ags_line_item_claim
        if isinstance(claim_payload, Mapping):
            raw_maximum = claim_payload.get("scoreMaximum")
            try:
                if raw_maximum is not None:
                    default_score_maximum = float(raw_maximum)
            except (TypeError, ValueError):
                default_score_maximum = None
            label_candidate = claim_payload.get("label")
            if isinstance(label_candidate, str) and label_candidate.strip():
                default_label = label_candidate

        return {
            "session_id": record.id,
            "registration_id": record.registration_id,
            "deployment_id": record.deployment_id,
            "resource_link_id": record.resource_link_id,
            "resource_link_ref": resource_link_ref,
            "platform_user_id": record.platform_user_id,
            "platform_context_id": record.platform_context_id,
            "line_items_endpoint": record.ags_line_items_endpoint,
            "line_item_endpoint": record.ags_line_item_endpoint,
            "scopes": scopes,
            "default_score_maximum": default_score_maximum,
            "default_label": default_label,
        }
    finally:
        if owns_session:
            db_session.close()


def resolve_public_base_url_from_request(request: Request) -> str | None:
    """Resolve the backend public base URL from the incoming HTTP request."""

    def _first_header(name: str) -> str | None:
        raw_value = request.headers.get(name)
        if not raw_value:
            return None
        return raw_value.split(",")[0].strip() or None

    forwarded_host = _first_header("x-forwarded-host")
    if forwarded_host:
        scheme = _first_header("x-forwarded-proto") or request.url.scheme
        forwarded_port = _first_header("x-forwarded-port")
        host = forwarded_host
        if forwarded_port and ":" not in host:
            host = f"{host}:{forwarded_port}"
        return f"{scheme}://{host}".rstrip("/")

    base_url = str(request.base_url).rstrip("/")
    return base_url or None


__all__ = [
    "build_chatkit_request_context",
    "resolve_public_base_url_from_request",
]
