"""Service layer handling persistence and lifecycle of MCP credentials."""

from __future__ import annotations

import datetime as _dt
import json
import logging
import secrets
from collections.abc import Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..admin_settings import _get_cipher
from ..database import SessionLocal
from ..models import McpCredential

logger = logging.getLogger("chatkit.mcp.credentials")

_DEFAULT_HTTP_TIMEOUT = 10.0
_TOKEN_EXPIRY_GRACE_SECONDS = 60


@dataclass(slots=True, frozen=True)
class ResolvedMcpCredential:
    """Materialized credential ready to be injected into MCP configuration."""

    id: int
    label: str
    provider: str | None
    auth_type: str
    authorization: str | None
    headers: dict[str, str]
    env: dict[str, str]
    secret_hint: str | None
    connected: bool


@dataclass(slots=True, frozen=True)
class McpCredentialPublic:
    """Public metadata returned to API consumers."""

    id: int
    label: str
    provider: str | None
    auth_type: str
    secret_hint: str | None
    connected: bool
    created_at: _dt.datetime
    updated_at: _dt.datetime


def _now() -> _dt.datetime:
    return _dt.datetime.now(_dt.UTC)


def _encrypt_payload(data: Mapping[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False).encode("utf-8")
    return _get_cipher().encrypt(payload).decode("utf-8")


def _decrypt_payload(value: str) -> dict[str, Any]:
    payload = _get_cipher().decrypt(value.encode("utf-8"))
    try:
        data = json.loads(payload)
    except json.JSONDecodeError as exc:  # pragma: no cover - defensive guard
        raise ValueError("Le contenu du secret MCP est illisible.") from exc
    if not isinstance(data, dict):
        raise ValueError("Le secret MCP stocké est invalide.")
    return data


def _mask_secret(value: str | None) -> str | None:
    if not value:
        return None
    trimmed = value.strip()
    if not trimmed:
        return None
    if len(trimmed) <= 4:
        return "•" * len(trimmed)
    return "•" * (len(trimmed) - 4) + trimmed[-4:]


def _sanitize_header_mapping(value: Mapping[str, Any] | None) -> dict[str, str]:
    if not value:
        return {}
    sanitized: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(key, str):
            continue
        key_trimmed = key.strip()
        if not key_trimmed:
            continue
        if isinstance(raw, str | int | float):
            sanitized[key_trimmed] = str(raw)
        elif isinstance(raw, bytes):
            try:
                sanitized[key_trimmed] = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
    return sanitized


def _sanitize_env_mapping(value: Mapping[str, Any] | None) -> dict[str, str]:
    if not value:
        return {}
    sanitized: dict[str, str] = {}
    for key, raw in value.items():
        if not isinstance(key, str):
            continue
        key_trimmed = key.strip()
        if not key_trimmed:
            continue
        if isinstance(raw, str | int | float):
            sanitized[key_trimmed] = str(raw)
        elif isinstance(raw, bytes):
            try:
                sanitized[key_trimmed] = raw.decode("utf-8")
            except UnicodeDecodeError:
                continue
    return sanitized


def _persist_payload(
    session: Session, credential: McpCredential, payload: Mapping[str, Any]
) -> None:
    credential.encrypted_payload = _encrypt_payload(payload)
    credential.updated_at = _now()
    session.add(credential)


def create_mcp_credential(
    session: Session,
    *,
    label: str,
    auth_type: str,
    provider: str | None = None,
    authorization: str | None = None,
    headers: Mapping[str, Any] | None = None,
    env: Mapping[str, Any] | None = None,
    oauth: Mapping[str, Any] | None = None,
) -> McpCredential:
    """Persist a new MCP credential entry."""

    normalized_label = label.strip()
    if not normalized_label:
        raise ValueError("Le libellé de l'identifiant MCP est requis.")

    normalized_type = auth_type.strip().lower()
    if normalized_type not in {"api_key", "oauth"}:
        raise ValueError("Le type d'identifiants MCP doit être 'api_key' ou 'oauth'.")

    payload: dict[str, Any] = {
        "type": normalized_type,
        "headers": _sanitize_header_mapping(headers),
        "env": _sanitize_env_mapping(env),
    }

    normalized_authorization = authorization.strip() if authorization else None
    if normalized_authorization:
        payload["authorization"] = normalized_authorization

    if normalized_type == "oauth":
        if not oauth:
            raise ValueError("La configuration OAuth est requise pour ce type.")
        oauth_payload = dict(oauth)
        if "authorization_url" not in oauth_payload or not str(
            oauth_payload.get("authorization_url", "")
        ).strip():
            raise ValueError("L'URL d'autorisation OAuth est requise.")
        if "token_url" not in oauth_payload or not str(
            oauth_payload.get("token_url", "")
        ).strip():
            raise ValueError("L'URL de jeton OAuth est requise.")
        client_id = oauth_payload.get("client_id")
        if not isinstance(client_id, str) or not client_id.strip():
            raise ValueError("Le client_id OAuth est requis.")
        oauth_payload["client_id"] = client_id.strip()
        client_secret = oauth_payload.get("client_secret")
        if isinstance(client_secret, str) and client_secret.strip():
            oauth_payload["client_secret"] = client_secret.strip()
        else:
            oauth_payload.pop("client_secret", None)

        scope = oauth_payload.get("scope")
        if isinstance(scope, list):
            scope_entries = [
                str(entry).strip()
                for entry in scope
                if str(entry).strip()
            ]
            scope_value = " ".join(scope_entries)
        elif isinstance(scope, str):
            scope_value = scope.strip()
        else:
            scope_value = None

        if scope_value:
            oauth_payload["scope"] = scope_value
        else:
            oauth_payload.pop("scope", None)

        extra_authorize = oauth_payload.get("extra_authorize_params")
        if isinstance(extra_authorize, Mapping):
            oauth_payload["extra_authorize_params"] = _sanitize_header_mapping(
                extra_authorize
            )
        else:
            oauth_payload.pop("extra_authorize_params", None)

        extra_token = oauth_payload.get("extra_token_params")
        if isinstance(extra_token, Mapping):
            oauth_payload["extra_token_params"] = _sanitize_header_mapping(extra_token)
        else:
            oauth_payload.pop("extra_token_params", None)

        payload["oauth"] = oauth_payload

    secret_hint = _mask_secret(normalized_authorization)

    provider_value = None
    if isinstance(provider, str):
        provider_value = provider.strip() or None

    credential = McpCredential(
        label=normalized_label,
        provider=provider_value,
        auth_type=normalized_type,
        secret_hint=secret_hint,
        encrypted_payload=_encrypt_payload(payload),
        created_at=_now(),
        updated_at=_now(),
    )
    session.add(credential)
    session.commit()
    session.refresh(credential)
    return credential


def delete_mcp_credential(session: Session, credential_id: int) -> bool:
    credential = session.get(McpCredential, credential_id)
    if credential is None:
        return False
    session.delete(credential)
    session.commit()
    return True


def prepare_public_credential(credential: McpCredential) -> McpCredentialPublic:
    return McpCredentialPublic(
        id=credential.id,
        label=credential.label,
        provider=credential.provider,
        auth_type=credential.auth_type,
        secret_hint=credential.secret_hint,
        connected=_is_credential_connected(credential),
        created_at=credential.created_at,
        updated_at=credential.updated_at,
    )


def list_mcp_credentials(session: Session) -> list[McpCredentialPublic]:
    query = select(McpCredential).order_by(McpCredential.created_at)
    rows = session.scalars(query).all()
    return [prepare_public_credential(row) for row in rows]


def _is_credential_connected(credential: McpCredential) -> bool:
    try:
        payload = _decrypt_payload(credential.encrypted_payload)
    except Exception:  # pragma: no cover - illisible
        return False
    if payload.get("type") == "api_key":
        authorization = payload.get("authorization")
        if isinstance(authorization, str) and authorization.strip():
            return True
        headers = payload.get("headers")
        if isinstance(headers, Mapping) and headers:
            return True
        env = payload.get("env")
        return isinstance(env, Mapping) and bool(env)
    if payload.get("type") == "oauth":
        oauth = payload.get("oauth")
        if isinstance(oauth, Mapping):
            access_token = oauth.get("access_token")
            if isinstance(access_token, str) and access_token.strip():
                return True
    return False


def _parse_datetime(value: Any) -> _dt.datetime | None:
    if isinstance(value, str) and value.strip():
        try:
            parsed = _dt.datetime.fromisoformat(value)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=_dt.UTC)
        return parsed
    return None


def _build_authorization(payload: Mapping[str, Any]) -> str | None:
    authorization = payload.get("authorization")
    if isinstance(authorization, str) and authorization.strip():
        return authorization.strip()
    oauth = payload.get("oauth")
    if isinstance(oauth, Mapping):
        token = oauth.get("access_token")
        token_type = oauth.get("token_type") or "Bearer"
        if isinstance(token, str) and token.strip():
            return f"{str(token_type).strip() or 'Bearer'} {token.strip()}"
    return None


def _update_hint_from_payload(
    credential: McpCredential, payload: Mapping[str, Any]
) -> None:
    authorization = _build_authorization(payload)
    if authorization:
        credential.secret_hint = _mask_secret(authorization)
    else:
        credential.secret_hint = None


def _should_refresh_token(oauth: Mapping[str, Any], *, now: _dt.datetime) -> bool:
    expires_at = _parse_datetime(oauth.get("expires_at"))
    if expires_at is None:
        return False
    return expires_at <= now + _dt.timedelta(seconds=_TOKEN_EXPIRY_GRACE_SECONDS)


def _refresh_oauth_token(
    session: Session,
    credential: McpCredential,
    payload: MutableMapping[str, Any],
    *,
    now: _dt.datetime,
) -> None:
    oauth = payload.get("oauth")
    if not isinstance(oauth, MutableMapping):
        return

    refresh_token = oauth.get("refresh_token")
    token_url = oauth.get("token_url")
    if not refresh_token or not token_url or not _should_refresh_token(oauth, now=now):
        return

    client_id = oauth.get("client_id")
    if not client_id:
        raise ValueError(
            "La configuration OAuth est incomplète : "
            "client_id manquant pour le refresh."
        )

    data: dict[str, str] = {
        "grant_type": "refresh_token",
        "refresh_token": str(refresh_token),
        "client_id": str(client_id),
    }
    client_secret = oauth.get("client_secret")
    if client_secret:
        data["client_secret"] = str(client_secret)

    extra = oauth.get("extra_token_params")
    if isinstance(extra, Mapping):
        for key, value in extra.items():
            if isinstance(key, str) and key not in data:
                data[key] = str(value)

    try:
        with httpx.Client(timeout=_DEFAULT_HTTP_TIMEOUT) as client:
            response = client.post(str(token_url), data=data)
            response.raise_for_status()
            token_data = response.json()
    except httpx.HTTPError as exc:
        logger.warning(
            "Impossible de rafraîchir le token OAuth MCP %s",
            credential.id,
            exc_info=exc,
        )
        raise ValueError("Le rafraîchissement du token OAuth MCP a échoué.") from exc

    access_token = token_data.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise ValueError("Le rafraîchissement OAuth ne fournit pas d'access_token.")

    oauth["access_token"] = access_token.strip()
    token_type = token_data.get("token_type")
    if isinstance(token_type, str) and token_type.strip():
        oauth["token_type"] = token_type.strip()

    expires_in = token_data.get("expires_in")
    if isinstance(expires_in, int | float):
        expires_at = _now() + _dt.timedelta(seconds=float(expires_in))
        oauth["expires_at"] = expires_at.isoformat()

    refresh_token_candidate = token_data.get("refresh_token")
    if isinstance(refresh_token_candidate, str) and refresh_token_candidate.strip():
        oauth["refresh_token"] = refresh_token_candidate.strip()

    payload["oauth"] = oauth
    _update_hint_from_payload(credential, payload)
    _persist_payload(session, credential, payload)
    session.commit()


def resolve_mcp_credential(
    credential_id: int,
    *,
    session: Session | None = None,
    now: _dt.datetime | None = None,
) -> ResolvedMcpCredential | None:
    """Return decrypted credential data ready for tool injection."""

    owns_session = session is None
    session = session or SessionLocal()
    try:
        credential = session.get(McpCredential, credential_id)
        if credential is None:
            return None
        payload = _decrypt_payload(credential.encrypted_payload)
        token_now = now or _now()
        if payload.get("type") == "oauth":
            try:
                _refresh_oauth_token(session, credential, payload, now=token_now)
                payload = _decrypt_payload(credential.encrypted_payload)
            except ValueError:
                logger.warning(
                    "Impossible de mettre à jour le token OAuth pour "
                    "l'identifiant MCP %s",
                    credential_id,
                )
        authorization = _build_authorization(payload)
        headers = _sanitize_header_mapping(payload.get("headers"))
        env = _sanitize_env_mapping(payload.get("env"))
        _update_hint_from_payload(credential, payload)
        _persist_payload(session, credential, payload)
        session.commit()
        return ResolvedMcpCredential(
            id=credential.id,
            label=credential.label,
            provider=credential.provider,
            auth_type=credential.auth_type,
            authorization=authorization,
            headers=headers,
            env=env,
            secret_hint=credential.secret_hint,
            connected=_is_credential_connected(credential),
        )
    finally:
        if owns_session:
            session.close()


def start_oauth_authorization(
    session: Session,
    *,
    credential_id: int,
    redirect_uri: str,
    scope_override: list[str] | None = None,
) -> dict[str, str]:
    credential = session.get(McpCredential, credential_id)
    if credential is None:
        raise ValueError("Identifiant MCP introuvable.")

    payload = _decrypt_payload(credential.encrypted_payload)
    if payload.get("type") != "oauth":
        raise ValueError("Seuls les identifiants OAuth peuvent lancer un flux OAuth.")

    oauth = payload.get("oauth")
    if not isinstance(oauth, MutableMapping):
        raise ValueError("Configuration OAuth invalide.")

    authorization_url = oauth.get("authorization_url")
    if not isinstance(authorization_url, str) or not authorization_url.strip():
        raise ValueError("L'URL d'autorisation OAuth est manquante.")

    client_id = oauth.get("client_id")
    if not isinstance(client_id, str) or not client_id.strip():
        raise ValueError("Le client_id OAuth est manquant.")

    state = secrets.token_urlsafe(24)
    scope = oauth.get("scope")
    if scope_override:
        scope = " ".join(entry for entry in scope_override if entry)
    query: dict[str, str] = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "state": state,
    }
    if scope:
        query["scope"] = str(scope)
    extra_authorize = oauth.get("extra_authorize_params")
    if isinstance(extra_authorize, Mapping):
        for key, value in extra_authorize.items():
            if isinstance(key, str) and key not in query:
                query[key] = str(value)

    from urllib.parse import urlencode

    separator = "&" if "?" in authorization_url else "?"
    authorization_link = f"{authorization_url}{separator}{urlencode(query)}"

    oauth["pending_state"] = state
    oauth["last_redirect_uri"] = redirect_uri
    payload["oauth"] = oauth
    _persist_payload(session, credential, payload)
    session.commit()

    return {"authorization_url": authorization_link, "state": state}


def complete_oauth_callback(
    session: Session,
    *,
    credential_id: int,
    code: str,
    state: str | None = None,
    redirect_uri: str | None = None,
) -> McpCredentialPublic:
    credential = session.get(McpCredential, credential_id)
    if credential is None:
        raise ValueError("Identifiant MCP introuvable.")

    payload = _decrypt_payload(credential.encrypted_payload)
    if payload.get("type") != "oauth":
        raise ValueError("Seuls les identifiants OAuth acceptent ce callback.")

    oauth = payload.get("oauth")
    if not isinstance(oauth, MutableMapping):
        raise ValueError("Configuration OAuth invalide.")

    expected_state = oauth.get("pending_state")
    if expected_state and state and expected_state != state:
        raise ValueError("Le paramètre state ne correspond pas à la session OAuth.")

    token_url = oauth.get("token_url")
    client_id = oauth.get("client_id")
    if not token_url or not client_id:
        raise ValueError("Configuration OAuth incomplète pour l'échange de code.")

    data: dict[str, str] = {
        "grant_type": "authorization_code",
        "code": code,
        "client_id": str(client_id),
    }
    redirect_target = redirect_uri or oauth.get("last_redirect_uri")
    if redirect_target:
        data["redirect_uri"] = str(redirect_target)

    client_secret = oauth.get("client_secret")
    if client_secret:
        data["client_secret"] = str(client_secret)

    scope = oauth.get("scope")
    if scope:
        data["scope"] = str(scope)

    extra_token = oauth.get("extra_token_params")
    if isinstance(extra_token, Mapping):
        for key, value in extra_token.items():
            if isinstance(key, str) and key not in data:
                data[key] = str(value)

    try:
        with httpx.Client(timeout=_DEFAULT_HTTP_TIMEOUT) as client:
            response = client.post(str(token_url), data=data)
            response.raise_for_status()
            token_data = response.json()
    except httpx.HTTPError as exc:
        logger.warning(
            "Échec de l'échange de code OAuth MCP %s",
            credential_id,
            exc_info=exc,
        )
        raise ValueError(
            "Impossible de finaliser l'authentification OAuth MCP."
        ) from exc

    access_token = token_data.get("access_token")
    if not isinstance(access_token, str) or not access_token.strip():
        raise ValueError("Le fournisseur OAuth n'a pas renvoyé d'access_token.")

    oauth["access_token"] = access_token.strip()
    token_type = token_data.get("token_type")
    if isinstance(token_type, str) and token_type.strip():
        oauth["token_type"] = token_type.strip()

    refresh_token = token_data.get("refresh_token")
    if isinstance(refresh_token, str) and refresh_token.strip():
        oauth["refresh_token"] = refresh_token.strip()

    expires_in = token_data.get("expires_in")
    if isinstance(expires_in, int | float):
        expires_at = _now() + _dt.timedelta(seconds=float(expires_in))
        oauth["expires_at"] = expires_at.isoformat()

    oauth.pop("pending_state", None)
    payload["oauth"] = oauth
    _update_hint_from_payload(credential, payload)
    _persist_payload(session, credential, payload)
    session.commit()
    session.refresh(credential)
    return prepare_public_credential(credential)
