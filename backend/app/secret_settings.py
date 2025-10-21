from __future__ import annotations

import datetime
from contextlib import contextmanager
from typing import Iterator

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .database import SessionLocal
from .models import SecretSetting

_OPENAI_API_KEY_NAME = "openai_api_key"


class MissingOpenAIAPIKeyError(RuntimeError):
    """Erreur levée lorsque la clé OpenAI est absente."""


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


@contextmanager
def _session_scope(session: Session | None) -> Iterator[Session]:
    if session is not None:
        yield session
        return

    with SessionLocal() as managed_session:
        yield managed_session


def _get_secret(session: Session, name: str) -> SecretSetting | None:
    return session.scalar(select(SecretSetting).where(SecretSetting.name == name))


def set_openai_api_key(session: Session, api_key: str) -> SecretSetting:
    sanitized = api_key.strip()
    if not sanitized:
        raise ValueError("La clé API ne peut pas être vide.")

    secret = _get_secret(session, _OPENAI_API_KEY_NAME)
    now = _now()
    if secret:
        secret.value = sanitized
        secret.updated_at = now
    else:
        secret = SecretSetting(
            name=_OPENAI_API_KEY_NAME,
            value=sanitized,
            created_at=now,
            updated_at=now,
        )

    session.add(secret)
    session.commit()
    session.refresh(secret)
    return secret


def get_openai_api_key(session: Session | None = None) -> str | None:
    with _session_scope(session) as managed_session:
        secret = _get_secret(managed_session, _OPENAI_API_KEY_NAME)
        if secret:
            return secret.value
    return None


def resolve_openai_api_key(session: Session | None = None) -> str:
    stored = get_openai_api_key(session)
    if stored:
        return stored

    settings = get_settings()
    if settings.openai_api_key:
        return settings.openai_api_key

    raise MissingOpenAIAPIKeyError(
        "Aucune clé OpenAI n'est configurée dans la base ou l'environnement."
    )


def get_openai_api_key_status(session: Session) -> dict[str, object]:
    secret = _get_secret(session, _OPENAI_API_KEY_NAME)
    if secret:
        return {"is_configured": True, "updated_at": secret.updated_at}

    settings = get_settings()
    return {"is_configured": bool(settings.openai_api_key), "updated_at": None}
