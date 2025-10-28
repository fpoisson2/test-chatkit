from __future__ import annotations

from fastapi import Request

from .chatkit import ChatKitRequestContext


def build_chatkit_request_context(
    current_user,
    request: Request | None = None,
    *,
    public_base_url: str | None = None,
    authorization: str | None = None,
) -> ChatKitRequestContext:
    """Construct a :class:`ChatKitRequestContext` for the given user."""

    base_url = (
        public_base_url
        if public_base_url is not None
        else (resolve_public_base_url_from_request(request) if request else None)
    )
    if authorization is None and request is not None:
        authorization = request.headers.get("Authorization")

    return ChatKitRequestContext(
        user_id=str(getattr(current_user, "id", None) or ""),
        email=getattr(current_user, "email", None),
        authorization=authorization,
        public_base_url=base_url,
    )


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
