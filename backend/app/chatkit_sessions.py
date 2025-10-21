from __future__ import annotations

import json
import logging
from collections.abc import Iterable
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
    filtered_pairs = [(key, value) for key, value in pairs if key not in MAX_TOKEN_FIELD_NAMES]

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


async def create_chatkit_session(user_id: str) -> dict:
    if not settings.chatkit_workflow_id:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "CHATKIT_WORKFLOW_ID is not configured",
                "hint": "Définissez CHATKIT_WORKFLOW_ID dans votre .env pour utiliser l'API ChatKit hébergée.",
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

    async with httpx.AsyncClient(base_url=settings.chatkit_api_base, timeout=30) as client:
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
    return sanitized_payload


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
        async with httpx.AsyncClient(base_url=settings.chatkit_api_base, timeout=timeout) as client:
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
