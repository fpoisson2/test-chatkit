from __future__ import annotations

import logging
from collections.abc import Iterable

import httpx
from fastapi import HTTPException, Request, Response, status
from starlette.responses import StreamingResponse

from .config import get_settings

settings = get_settings()
logger = logging.getLogger("chatkit.server")

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
    async with httpx.AsyncClient(base_url=settings.chatkit_api_base, timeout=30) as client:
        response = await client.post(
            "/v1/chatkit/sessions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {settings.openai_api_key}",
                "OpenAI-Beta": "chatkit_beta=v1",
            },
            json={
                "workflow": {"id": settings.workflow_id},
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
            },
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
    return response.json()


async def proxy_chatkit_request(path: str, request: Request) -> Response:
    if request.method == "OPTIONS":
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    relative_path = path.lstrip("/")
    upstream_path = f"/v1/chatkit/{relative_path}" if relative_path else "/v1/chatkit"
    if request.url.query:
        upstream_path = f"{upstream_path}?{request.url.query}"

    try:
        body = await request.body()
    except Exception:  # pragma: no cover - lecture du flux
        body = b""

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
    except httpx.RequestError as exc:  # pragma: no cover - remontée d'erreur réseau
        logger.error("ChatKit proxy request failed", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="ChatKit upstream request failed",
        ) from exc
