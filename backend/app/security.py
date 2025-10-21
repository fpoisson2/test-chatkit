from __future__ import annotations

import datetime
import hashlib
import os
import secrets
from typing import Any

import jwt
from fastapi import HTTPException, status

from .config import get_settings
from .database import SessionLocal
from .models import User, Workflow, WorkflowDefinition, WorkflowStep, WorkflowTransition
from .workflows import WorkflowService

settings = get_settings()


def hash_password(password: str, salt: str | None = None) -> str:
    if not salt:
        salt = secrets.token_hex(16)
    salt_bytes = salt.encode("utf-8")
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_bytes, 390000)
    return f"{salt}${hashed.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, _hashed = stored_hash.split("$", 1)
    except ValueError:
        return False
    expected = hash_password(password, salt)
    return secrets.compare_digest(expected, stored_hash)

def _reset_workflow_state_for_tests() -> None:
    """Réinitialise les workflows entre les tests Pytest."""

    if "PYTEST_CURRENT_TEST" not in os.environ:
        return

    with SessionLocal() as session:
        session.query(WorkflowTransition).delete()
        session.query(WorkflowStep).delete()
        session.query(WorkflowDefinition).delete()
        session.query(Workflow).delete()
        session.commit()
        WorkflowService().get_current(session=session)


def create_access_token(user: User) -> str:
    _reset_workflow_state_for_tests()
    expire = datetime.datetime.utcnow() + datetime.timedelta(
        minutes=settings.access_token_expire_minutes
    )
    payload = {
        "sub": str(user.id),
        "email": user.email,
        "is_admin": user.is_admin,
        "exp": expire,
    }
    return jwt.encode(payload, settings.auth_secret_key, algorithm="HS256")


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token invalide") from exc


def create_agent_image_token(
    image_name: str,
    *,
    user_id: str | None,
    thread_id: str | None,
) -> str:
    """Génère un jeton signé permettant d'accéder à une image générée."""

    expire = datetime.datetime.utcnow() + datetime.timedelta(
        seconds=settings.agent_image_token_ttl_seconds
    )
    payload: dict[str, Any] = {"img": image_name, "exp": expire}
    if user_id:
        payload["sub"] = str(user_id)
    if thread_id:
        payload["thr"] = thread_id
    return jwt.encode(payload, settings.auth_secret_key, algorithm="HS256")


def decode_agent_image_token(token: str) -> dict[str, Any]:
    """Vérifie et retourne le contenu d'un jeton d'accès image."""

    try:
        return jwt.decode(token, settings.auth_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as exc:  # type: ignore[attr-defined]
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token d'image invalide",
        ) from exc
