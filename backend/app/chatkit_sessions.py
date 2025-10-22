from __future__ import annotations

import datetime
import json
import logging
import math
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from typing import Any
from urllib.parse import parse_qsl, urlencode

import httpx
from fastapi import HTTPException, Request, Response, status
from starlette.responses import StreamingResponse

from .config import get_settings
from .token_sanitizer import MAX_TOKEN_FIELD_NAMES, sanitize_value

settings = get_settings()
logger = logging.getLogger("chatkit.sessions")

_HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}


DEFAULT_SESSION_TTL = datetime.timedelta(minutes=9)


def _format_datetime(value: datetime.datetime) -> str:
    """Retourne une représentation ISO-8601 normalisée en UTC."""

    if value.tzinfo is None:
        value = value.replace(tzinfo=datetime.timezone.utc)
    else:
        value = value.astimezone(datetime.timezone.utc)
    return value.isoformat().replace("+00:00", "Z")


@dataclass
class ParsedSessionSecret:
    """Résultat de l'extraction d'un secret de session."""

    raw: Any | None
    expires_at: datetime.datetime | None

    def unwrap(self) -> Any | None:
        if isinstance(self.raw, dict) and "value" in self.raw:
            return self.raw["value"]
        return self.raw

    def as_text(self) -> str | None:
        value = self.unwrap()
        return value if isinstance(value, str) else None

    def expires_at_isoformat(self) -> str | None:
        if self.expires_at is None:
            return None
        return _format_datetime(self.expires_at)


class SessionSecretParser:
    """Normalise l'extraction des secrets de session ChatKit."""

    def __init__(
        self,
        *,
        clock: Callable[[], datetime.datetime] | None = None,
        default_ttl: datetime.timedelta | None = DEFAULT_SESSION_TTL,
    ) -> None:
        self._clock = clock or (lambda: datetime.datetime.now(datetime.timezone.utc))
        self._default_ttl = default_ttl

    def parse(self, payload: Any) -> ParsedSessionSecret:
        now = self._clock()
        fallback_expiration = self._infer_expiration(payload, now)

        for container in self._iter_containers(payload):
            secret = self._extract_secret(container)
            if secret is None:
                continue

            expiration = (
                self._infer_expiration(container, now)
                or (
                    self._infer_expiration(secret, now)
                    if isinstance(secret, dict)
                    else None
                )
                or fallback_expiration
            )

            if expiration is None and self._default_ttl is not None:
                expiration = now + self._default_ttl

            return ParsedSessionSecret(raw=secret, expires_at=expiration)

        return ParsedSessionSecret(raw=None, expires_at=fallback_expiration)

    def _iter_containers(self, payload: Any) -> list[dict[str, Any]]:
        if not isinstance(payload, dict):
            return []

        containers: list[dict[str, Any]] = [payload]
        for key in ("session", "data", "result"):
            candidate = payload.get(key)
            if isinstance(candidate, dict):
                containers.append(candidate)
        return containers

    @staticmethod
    def _extract_secret(container: Any) -> Any | None:
        if not isinstance(container, dict):
            return None

        secret = container.get("client_secret") or container.get("clientSecret")
        if secret is None and "value" in container:
            secret = container["value"]
        return secret

    def _infer_expiration(
        self,
        source: Any,
        now: datetime.datetime,
    ) -> datetime.datetime | None:
        if not isinstance(source, dict):
            return None

        for key in ("expires_at", "expiresAt"):
            if key in source:
                timestamp = self._parse_timestamp(source[key])
                if timestamp is not None:
                    return timestamp

        for key in (
            "expires_after",
            "expiresAfter",
            "ttl",
            "ttl_seconds",
            "ttlSeconds",
        ):
            if key in source:
                duration = self._parse_duration(source[key])
                if duration is not None:
                    return now + duration

        return None

    @staticmethod
    def _parse_timestamp(value: Any) -> datetime.datetime | None:
        if isinstance(value, datetime.datetime):
            return (
                value if value.tzinfo else value.replace(tzinfo=datetime.timezone.utc)
            )

        if isinstance(value, int | float) and math.isfinite(value):
            if value <= 0:
                return None
            seconds = value / 1000 if value > 10_000_000_000 else value
            return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc)

        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                numeric = float(stripped)
            except ValueError:
                numeric = None
            if numeric is not None and math.isfinite(numeric) and numeric > 0:
                seconds = numeric / 1000 if numeric > 10_000_000_000 else numeric
                return datetime.datetime.fromtimestamp(seconds, datetime.timezone.utc)

            try:
                parsed = datetime.datetime.fromisoformat(
                    stripped.replace("Z", "+00:00")
                )
            except ValueError:
                try:
                    from email.utils import parsedate_to_datetime

                    parsed = parsedate_to_datetime(stripped)
                except (TypeError, ValueError, IndexError):
                    return None
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=datetime.timezone.utc)
            return parsed.astimezone(datetime.timezone.utc)

        return None

    @classmethod
    def _parse_duration(cls, value: Any) -> datetime.timedelta | None:
        if isinstance(value, datetime.timedelta):
            return value if value > datetime.timedelta(0) else None

        if isinstance(value, int | float) and math.isfinite(value):
            if value <= 0:
                return None
            seconds = value / 1000 if value > 10_000 else value
            return datetime.timedelta(seconds=seconds)

        if isinstance(value, str):
            stripped = value.strip()
            if not stripped:
                return None
            try:
                numeric = float(stripped)
            except ValueError:
                return None
            if not math.isfinite(numeric) or numeric <= 0:
                return None
            seconds = numeric / 1000 if numeric > 10_000 else numeric
            return datetime.timedelta(seconds=seconds)

        if isinstance(value, dict):
            for key in ("milliseconds", "ms", "seconds", "value"):
                if key in value:
                    candidate = cls._parse_duration(value[key])
                    if candidate is not None:
                        return candidate
            return None

        return None


def summarize_payload_shape(payload: Any) -> dict[str, Any] | str:
    """Fournit un résumé non sensible de la réponse pour le débogage."""

    if not isinstance(payload, dict):
        return str(type(payload))

    summary: dict[str, Any] = {}
    for key, value in payload.items():
        if key in {"client_secret", "clientSecret", "value"}:
            summary[key] = "***"
            continue
        if isinstance(value, dict):
            summary[key] = {
                sub_key: type(sub_value).__name__
                for sub_key, sub_value in value.items()
            }
        elif isinstance(value, list):
            summary[key] = f"list(len={len(value)})"
        else:
            summary[key] = type(value).__name__
    return summary


def _sanitize_json_body(
    body: bytes | None,
    *,
    content_type: str | None,
    log_context: str,
) -> bytes | None:
    if not body:
        return body

    if not content_type or "json" not in content_type.lower():
        return body

    try:
        parsed = json.loads(body)
    except ValueError:
        return body

    sanitized, removed = sanitize_value(parsed)
    if not removed:
        return body

    logger.debug("Removed max token fields from %s payload", log_context)
    return json.dumps(sanitized, ensure_ascii=False).encode("utf-8")


def _sanitize_query_string(query: str) -> tuple[str, bool]:
    if not query:
        return "", False

    pairs = parse_qsl(query, keep_blank_values=True)
    filtered_pairs = [
        (key, value) for key, value in pairs if key not in MAX_TOKEN_FIELD_NAMES
    ]

    if len(filtered_pairs) == len(pairs):
        return query, False

    sanitized = urlencode(filtered_pairs, doseq=True)
    return sanitized, True


def _sanitize_forward_headers(
    headers: Iterable[tuple[str, str]],
    *,
    include_chatkit_beta: bool,
) -> list[tuple[str, str]]:
    sanitized: list[tuple[str, str]] = []
    seen_lower: set[str] = set()
    for key, value in headers:
        lower_key = key.lower()
        if lower_key in _HOP_BY_HOP_HEADERS or lower_key == "content-length":
            continue
        sanitized.append((key, value))
        seen_lower.add(lower_key)

    if include_chatkit_beta and "openai-beta" not in seen_lower:
        sanitized.append(("OpenAI-Beta", "chatkit_beta=v1"))

    return sanitized


async def create_chatkit_session(user_id: str) -> dict[str, Any]:
    if not settings.chatkit_workflow_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "CHATKIT_WORKFLOW_ID is not configured",
                "hint": (
                    "Définissez CHATKIT_WORKFLOW_ID dans votre .env pour utiliser "
                    "l'API ChatKit hébergée."
                ),
            },
        )

    payload = {
        "workflow": {"id": settings.chatkit_workflow_id},
        "user": user_id,
        "chatkit_configuration": {
            "file_upload": {
                "enabled": True,
            }
        },
        "expires_after": {
            "anchor": "created_at",
            "seconds": 600,
        },
        "rate_limits": {"max_requests_per_1_minute": 50},
    }

    async with httpx.AsyncClient(
        base_url=settings.chatkit_api_base, timeout=30
    ) as client:
        response = await client.post(
            "/v1/chatkit/sessions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.openai_api_key}",
                "OpenAI-Beta": "chatkit_beta=v1",
            },
            json=payload,
        )

    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = {"error": response.text}
        logger.error(
            "ChatKit session creation failed (%s): %s",
            response.status_code,
            detail,
        )
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "error": f"ChatKit session creation failed: {response.status_code}",
                "details": detail,
            },
        )

    raw_payload = response.json()
    sanitized_payload, removed = sanitize_value(raw_payload)
    if removed:
        logger.debug("Removed max token fields from ChatKit session response")

    parser = SessionSecretParser()
    parsed_secret = parser.parse(sanitized_payload)
    if parsed_secret.raw is None:
        summary = summarize_payload_shape(sanitized_payload)
        logger.error(
            "Client secret introuvable dans la réponse ChatKit : %s",
            summary,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit response missing client_secret",
                "payload_summary": summary,
            },
        )

    client_secret = parsed_secret.as_text()
    if client_secret is None:
        summary = summarize_payload_shape(parsed_secret.raw)
        logger.error(
            "Format de client_secret non pris en charge : %s",
            summary,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit response returned an unsupported client_secret shape",
                "payload_summary": summary,
            },
        )

    return {
        "client_secret": client_secret,
        "expires_at": parsed_secret.expires_at_isoformat(),
    }


async def proxy_chatkit_request(path: str, request: Request) -> Response:
    if request.method == "OPTIONS":
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    relative_path = path.lstrip("/")
    upstream_path = f"/v1/chatkit/{relative_path}" if relative_path else "/v1/chatkit"
    if request.url.query:
        sanitized_query, removed_from_query = _sanitize_query_string(request.url.query)
        if sanitized_query:
            upstream_path = f"{upstream_path}?{sanitized_query}"
        if removed_from_query:
            logger.debug("Removed max token fields from ChatKit proxy query")

    try:
        body = await request.body()
    except Exception:  # pragma: no cover
        body = b""

    body = _sanitize_json_body(
        body,
        content_type=request.headers.get("content-type"),
        log_context="ChatKit proxy request",
    )

    upstream_headers = _sanitize_forward_headers(
        request.headers.items(),
        include_chatkit_beta=True,
    )

    timeout = httpx.Timeout(60.0, read=None)
    try:
        async with httpx.AsyncClient(
            base_url=settings.chatkit_api_base, timeout=timeout
        ) as client:
            async with client.stream(
                request.method,
                upstream_path,
                headers=upstream_headers,
                content=body or None,
            ) as upstream_response:
                response = StreamingResponse(
                    upstream_response.aiter_raw(),
                    status_code=upstream_response.status_code,
                    media_type=upstream_response.headers.get("content-type"),
                )
                for key, value in _sanitize_forward_headers(
                    upstream_response.headers.items(),
                    include_chatkit_beta=False,
                ):
                    if key.lower() == "content-type":
                        continue
                    response.headers.append(key, value)
                return response
    except httpx.RequestError as exc:  # pragma: no cover
        logger.error("ChatKit proxy request failed", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="ChatKit upstream request failed",
        ) from exc
