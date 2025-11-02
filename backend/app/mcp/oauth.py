from __future__ import annotations

import base64
import hashlib
import logging
import secrets
import time
from collections.abc import Mapping
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal
from urllib.parse import parse_qsl, urlencode, urljoin, urlparse, urlunparse

import httpx

from ..database import SessionLocal
from ..models import McpServer
from ..secret_utils import decrypt_secret

SESSION_TTL_SECONDS = 300


@dataclass
class OAuthSession:
    state: str
    code_verifier: str
    token_endpoint: str
    client_id: str | None
    scope: str | None
    redirect_uri: str
    expires_at: float
    server_id: int | None = None
    status: Literal["pending", "ok", "error"] = "pending"
    token: dict[str, Any] | None = None
    error: str | None = None

    def remaining_seconds(self, *, now: float | None = None) -> int:
        current = time.time() if now is None else now
        return max(0, int(self.expires_at - current))

    def is_expired(self, *, now: float | None = None) -> bool:
        current = time.time() if now is None else now
        return current >= self.expires_at


_sessions: dict[str, OAuthSession] = {}
_sessions_lock = Lock()

logger = logging.getLogger("chatkit.mcp.oauth")


def _generate_state() -> str:
    return secrets.token_urlsafe(24)


def _generate_code_verifier() -> str:
    verifier = base64.urlsafe_b64encode(secrets.token_bytes(32)).decode("ascii")
    return verifier.rstrip("=")


def _build_code_challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


def _cleanup_expired_sessions(*, now: float | None = None) -> None:
    current = time.time() if now is None else now
    with _sessions_lock:
        expired = [
            state
            for state, session in _sessions.items()
            if session.is_expired(now=current)
        ]
        for state in expired:
            _sessions.pop(state, None)


def _store_session(session: OAuthSession) -> None:
    with _sessions_lock:
        _sessions[session.state] = session


def _get_session(state: str, *, now: float | None = None) -> OAuthSession | None:
    current = time.time() if now is None else now
    with _sessions_lock:
        session = _sessions.get(state)
        if session is None:
            return None
        if session.is_expired(now=current):
            _sessions.pop(state, None)
            return None
        return session


def _update_session(state: str, **updates: Any) -> None:
    with _sessions_lock:
        session = _sessions.get(state)
        if session is None:
            return
        for key, value in updates.items():
            setattr(session, key, value)


def _resolve_token_endpoint_auth_method(
    metadata: Mapping[str, Any] | None,
) -> str | None:
    if not isinstance(metadata, Mapping):
        return None

    candidate = metadata.get("token_endpoint_auth_method")
    if isinstance(candidate, str) and candidate.strip():
        return candidate.strip().lower()

    supported = metadata.get("token_endpoint_auth_methods_supported")
    if isinstance(supported, list | tuple | set):
        for entry in supported:
            if isinstance(entry, str) and entry.strip():
                normalized = entry.strip().lower()
                if normalized in {"client_secret_basic", "client_secret_post", "none"}:
                    return normalized

    return None


def _extract_token_request_params(
    metadata: Mapping[str, Any] | None,
) -> dict[str, str]:
    if not isinstance(metadata, Mapping):
        return {}

    params: dict[str, str] = {}

    for key in ("token_request", "token_request_params", "token_params"):
        value = metadata.get(key)
        if isinstance(value, Mapping):
            for param_key, param_value in value.items():
                if not isinstance(param_key, str):
                    continue
                if param_value is None:
                    continue
                if isinstance(param_value, str | int | float | bool):
                    if param_key not in params:
                        params[param_key] = str(param_value)

    for extra_key in ("resource", "audience"):
        value = metadata.get(extra_key)
        if isinstance(value, str | int | float | bool) and extra_key not in params:
            params[extra_key] = str(value)

    return params


def _extract_token_request_headers(
    metadata: Mapping[str, Any] | None,
) -> dict[str, str]:
    if not isinstance(metadata, Mapping):
        return {}

    headers: dict[str, str] = {}
    for key in ("token_request_headers", "token_headers"):
        value = metadata.get(key)
        if isinstance(value, Mapping):
            for header_key, header_value in value.items():
                if (
                    isinstance(header_key, str)
                    and header_key.strip()
                    and isinstance(header_value, str)
                ):
                    headers[header_key.strip()] = header_value.strip()
    return headers


def _resolve_endpoint(
    endpoint: str,
    *,
    base_url: str,
    issuer: str | None = None,
) -> str:
    parsed = urlparse(endpoint)
    if parsed.scheme and parsed.netloc:
        return endpoint

    base_candidate = issuer if issuer else base_url
    return urljoin(base_candidate, endpoint)


async def start_oauth_flow(
    base_url: str,
    *,
    redirect_uri: str,
    client_id: str | None = None,
    scope: str | None = None,
    server_id: int | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Initialise un flux OAuth2 avec PKCE et renvoie l'URL d'autorisation."""

    _cleanup_expired_sessions()

    state = _generate_state()
    code_verifier = _generate_code_verifier()
    code_challenge = _build_code_challenge(code_verifier)

    discovery_url = urljoin(str(base_url), "/.well-known/oauth-authorization-server")

    logger.info(
        "Starting OAuth flow base_url=%s client_id_present=%s scope_present=%s "
        "server_id=%s",
        base_url,
        bool(client_id),
        bool(scope),
        server_id,
    )

    close_client = False
    if http_client is None:
        http_client = httpx.AsyncClient()
        close_client = True

    try:
        response = await http_client.get(discovery_url)
        response.raise_for_status()
        discovery = response.json()
    except httpx.HTTPError as exc:  # pragma: no cover - garde-fou réseau
        if close_client:
            await http_client.aclose()
        raise ValueError("Impossible de découvrir la configuration OAuth2.") from exc

    logger.debug(
        "OAuth discovery response keys=%s",
        sorted(discovery.keys()) if isinstance(discovery, dict) else type(discovery),
    )

    authorization_endpoint = discovery.get("authorization_endpoint")
    token_endpoint = discovery.get("token_endpoint")
    registration_endpoint = discovery.get("registration_endpoint")
    discovered_client_id = discovery.get("client_id")

    issuer = discovery.get("issuer")
    issuer_base = issuer if isinstance(issuer, str) and issuer else base_url

    if not authorization_endpoint or not token_endpoint:
        raise ValueError("La découverte OAuth2 ne fournit pas les endpoints attendus.")

    # Si pas de client_id fourni et qu'un registration_endpoint est disponible,
    # tenter un enregistrement dynamique du client.
    effective_client_id = discovered_client_id if discovered_client_id else client_id

    if not effective_client_id and registration_endpoint:
        logger.info("No client_id provided, attempting dynamic client registration")

        registration_url = _resolve_endpoint(
            registration_endpoint,
            base_url=base_url,
            issuer=issuer_base,
        )

        try:
            registration_payload = {
                "client_name": "ChatKit MCP Client",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none",  # PKCE public client
            }

            logger.debug(
                "Registering OAuth client registration_url=%s redirect_uri=%s",
                registration_url,
                redirect_uri,
            )

            reg_response = await http_client.post(
                registration_url,
                json=registration_payload,
            )
            reg_response.raise_for_status()
            registration_data = reg_response.json()

            effective_client_id = registration_data.get("client_id")
            logger.info(
                "Dynamic client registration successful client_id=%s",
                effective_client_id,
            )
        except httpx.HTTPError as exc:
            logger.warning(
                "Dynamic client registration failed: %s",
                exc,
                exc_info=True,
            )
            if close_client:
                await http_client.aclose()
            raise ValueError(
                "Impossible d'enregistrer le client OAuth dynamiquement."
            ) from exc

    # Fermer le client HTTP si on l'a créé
    if close_client:
        await http_client.aclose()

    logger.debug(
        "OAuth configuration discovered_client_id=%s provided_client_id=%s "
        "effective_client_id=%s",
        discovered_client_id,
        client_id,
        effective_client_id,
    )

    authorization_endpoint = _resolve_endpoint(
        authorization_endpoint,
        base_url=base_url,
        issuer=issuer_base,
    )
    token_endpoint = _resolve_endpoint(
        token_endpoint,
        base_url=base_url,
        issuer=issuer_base,
    )

    # Construit l'URL d'autorisation avec les paramètres requis.
    params = [
        ("response_type", "code"),
        ("redirect_uri", redirect_uri),
        ("state", state),
        ("code_challenge", code_challenge),
        ("code_challenge_method", "S256"),
    ]
    if effective_client_id:
        params.append(("client_id", effective_client_id))
    if scope:
        params.append(("scope", scope))

    parsed_authorize = urlparse(authorization_endpoint)
    existing_params = parse_qsl(parsed_authorize.query, keep_blank_values=True)
    new_query = urlencode(existing_params + params)
    authorization_url = urlunparse(parsed_authorize._replace(query=new_query))

    session = OAuthSession(
        state=state,
        code_verifier=code_verifier,
        token_endpoint=token_endpoint,
        client_id=effective_client_id,
        scope=scope,
        redirect_uri=redirect_uri,
        expires_at=time.time() + SESSION_TTL_SECONDS,
        server_id=server_id,
    )
    _store_session(session)

    logger.debug(
        "Stored OAuth session state=%s token_endpoint=%s client_id=%s scope=%s "
        "server_id=%s",
        state,
        token_endpoint,
        effective_client_id,
        scope,
        server_id,
    )

    result = {
        "authorization_url": authorization_url,
        "state": state,
        "expires_in": SESSION_TTL_SECONDS,
        "redirect_uri": redirect_uri,
    }

    if server_id is not None:
        result["server_id"] = server_id

    return result


async def complete_oauth_callback(
    *,
    state: str,
    code: str | None,
    error: str | None = None,
    error_description: str | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> dict[str, Any]:
    """Finalise un flux OAuth2 après le callback du fournisseur."""

    _cleanup_expired_sessions()
    session = _get_session(state)
    if session is None:
        raise ValueError("Session OAuth inconnue ou expirée.")

    logger.info(
        "Completing OAuth callback state=%s has_code=%s has_error=%s client_id=%s "
        "server_id=%s",
        state,
        bool(code),
        bool(error),
        session.client_id,
        session.server_id,
    )

    if error:
        message = error_description or error
        _update_session(state, status="error", error=message)
        return {"state": state, "status": "error", "error": message}

    if not code:
        raise ValueError(
            "Le paramètre 'code' est requis pour finaliser l'authentification."
        )

    client_id_value = session.client_id
    scope_value = session.scope
    metadata: Mapping[str, Any] | None = None
    client_secret: str | None = None

    if session.server_id is not None:
        try:
            with SessionLocal() as db_session:
                record = db_session.get(McpServer, session.server_id)
            if record is not None:
                raw_client_id = getattr(record, "oauth_client_id", None)
                if (not client_id_value) and isinstance(raw_client_id, str):
                    stripped_client_id = raw_client_id.strip()
                    if stripped_client_id:
                        client_id_value = stripped_client_id

                raw_secret = decrypt_secret(
                    getattr(record, "oauth_client_secret_encrypted", None)
                )
                if isinstance(raw_secret, str):
                    stripped_secret = raw_secret.strip()
                    if stripped_secret:
                        client_secret = stripped_secret

                record_metadata = getattr(record, "oauth_metadata", None)
                if isinstance(record_metadata, Mapping):
                    metadata = dict(record_metadata)
        except Exception as exc:  # pragma: no cover - récupération best effort
            logger.warning(
                "Unable to load MCP server %s for OAuth state=%s: %s",
                session.server_id,
                state,
                exc,
            )

    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": session.redirect_uri,
        "code_verifier": session.code_verifier,
    }
    if client_id_value:
        data["client_id"] = client_id_value
    if scope_value:
        data["scope"] = scope_value

    headers = _extract_token_request_headers(metadata)

    extra_params = _extract_token_request_params(metadata)
    for key, value in extra_params.items():
        if key not in data:
            data[key] = value

    auth_method = _resolve_token_endpoint_auth_method(metadata)

    if client_secret:
        logger.debug(
            "OAuth state=%s using stored client_secret (length=%d) auth_method=%s",
            state,
            len(client_secret),
            auth_method or "<default>",
        )
        if auth_method is None:
            auth_method = "client_secret_basic"
            if not client_id_value:
                auth_method = "client_secret_post"

        if auth_method == "client_secret_basic" and client_id_value:
            basic_payload = f"{client_id_value}:{client_secret}".encode()
            encoded = base64.b64encode(basic_payload).decode("ascii")
            headers.setdefault("Authorization", f"Basic {encoded}")
        elif auth_method == "client_secret_post":
            data.setdefault("client_secret", client_secret)
        elif auth_method == "none":
            logger.debug(
                "OAuth state=%s token exchange configured for public client",
                state,
            )
        else:
            if client_id_value:
                basic_payload = f"{client_id_value}:{client_secret}".encode()
                encoded = base64.b64encode(basic_payload).decode("ascii")
                headers.setdefault("Authorization", f"Basic {encoded}")
            else:
                data.setdefault("client_secret", client_secret)

    close_client = False
    if http_client is None:
        http_client = httpx.AsyncClient()
        close_client = True

    try:
        logger.debug(
            "Exchanging authorization code state=%s token_endpoint=%s payload_keys=%s "
            "headers=%s",
            state,
            session.token_endpoint,
            sorted(data.keys()),
            sorted(headers.keys()),
        )
        response = await http_client.post(
            session.token_endpoint,
            data=data,
            headers=headers or None,
        )
        response.raise_for_status()
        token_payload = response.json()

        logger.debug(
            "Token exchange successful token_keys=%s",
            (
                sorted(token_payload.keys())
                if isinstance(token_payload, dict)
                else type(token_payload)
            ),
        )
    except httpx.HTTPStatusError as exc:
        error_detail: str | None = None
        try:
            payload = exc.response.json()
        except ValueError:  # pragma: no cover - contenu non JSON
            payload = None

        if isinstance(payload, dict):
            error_code = payload.get("error")
            description = payload.get("error_description")
            if isinstance(error_code, str) and isinstance(description, str):
                merged = f"{error_code.strip()}: {description.strip()}".strip(": ")
                error_detail = merged or None
            elif isinstance(description, str):
                error_detail = description.strip() or None
            elif isinstance(error_code, str):
                error_detail = error_code.strip() or None

        if error_detail is None:
            text = exc.response.text.strip()
            if text:
                error_detail = text

        message = error_detail or "Échec de l'échange du code d'autorisation."
        _update_session(state, status="error", error=message)
        return {
            "state": state,
            "status": "error",
            "error": message,
        }
    except httpx.HTTPError:  # pragma: no cover - garde-fou réseau
        message = "Échec de l'échange du code d'autorisation."
        _update_session(state, status="error", error=message)
        return {
            "state": state,
            "status": "error",
            "error": message,
        }
    finally:
        if close_client:
            await http_client.aclose()

    _update_session(state, status="ok", token=token_payload)
    return {"state": state, "status": "ok", "token": token_payload}


async def get_oauth_session_status(state: str) -> dict[str, Any] | None:
    """Retourne l'état courant d'une session OAuth, ou ``None`` si absente."""

    _cleanup_expired_sessions()
    session = _get_session(state)
    if session is None:
        return None

    payload: dict[str, Any] = {
        "state": session.state,
        "status": session.status,
        "expires_in": session.remaining_seconds(),
    }
    if session.status == "ok" and session.token is not None:
        payload["token"] = session.token
    if session.status == "error" and session.error:
        payload["error"] = session.error

    return payload


async def delete_oauth_session(state: str) -> bool:
    """Supprime explicitement une session OAuth si elle existe."""

    with _sessions_lock:
        return _sessions.pop(state, None) is not None
