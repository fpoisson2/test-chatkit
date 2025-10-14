from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from fastapi.responses import StreamingResponse

try:  # pragma: no cover - dépendance optionnelle pour les tests
    from chatkit.server import StreamingResult
except ModuleNotFoundError:  # pragma: no cover - utilisé uniquement quand ChatKit n'est pas installé
    class StreamingResult:  # type: ignore[override]
        """Bouchon minimal utilisé lorsque le SDK ChatKit n'est pas disponible."""

        pass


if TYPE_CHECKING:  # pragma: no cover - uniquement pour l'auto-complétion
    from ..chatkit import ChatKitRequestContext

from ..chatkit_realtime import create_realtime_voice_session
from ..chatkit_sessions import create_chatkit_session, proxy_chatkit_request
from ..config import get_settings
from ..dependencies import get_current_user
from ..models import User
from ..schemas import SessionRequest, VoiceSessionRequest, VoiceSessionResponse

router = APIRouter()


logger = logging.getLogger("chatkit.voice")


def _normalize_expiration(value: Any) -> str | None:
    """Convertit une valeur d'expiration en chaîne lorsque c'est possible."""

    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return str(value)
    return None


def _extract_secret_from_container(container: Any) -> tuple[Any | None, str | None]:
    """Retourne un éventuel secret client et son expiration depuis un conteneur."""

    if not isinstance(container, dict):
        return None, None

    secret = container.get("client_secret") or container.get("clientSecret")
    if not secret:
        return None, None

    expires = (
        _normalize_expiration(container.get("expires_at"))
        or _normalize_expiration(container.get("expires_after"))
    )

    if isinstance(secret, dict):
        expires = (
            expires
            or _normalize_expiration(secret.get("expires_at"))
            or _normalize_expiration(secret.get("expires_after"))
        )

    return secret, expires


def _resolve_voice_client_secret(payload: dict[str, Any]) -> tuple[Any | None, str | None]:
    """Tente d'extraire un client_secret exploitable de la réponse OpenAI."""

    direct_secret, direct_expiration = _extract_secret_from_container(payload)
    if direct_secret is not None:
        expires = (
            direct_expiration
            or _normalize_expiration(payload.get("expires_at"))
            or _normalize_expiration(payload.get("expires_after"))
        )
        return direct_secret, expires

    for key in ("data", "session"):
        nested_secret, nested_expiration = _extract_secret_from_container(
            payload.get(key)
        )
        if nested_secret is not None:
            expires = (
                nested_expiration
                or _normalize_expiration(payload.get("expires_at"))
                or _normalize_expiration(payload.get("expires_after"))
            )
            return nested_secret, expires

    fallback_expiration = (
        _normalize_expiration(payload.get("expires_at"))
        or _normalize_expiration(payload.get("expires_after"))
    )
    return None, fallback_expiration


def _summarize_payload_shape(payload: Any) -> dict[str, Any] | str:
    """Fournit un résumé non sensible de la réponse pour le débogage."""

    if not isinstance(payload, dict):
        return str(type(payload))

    summary: dict[str, Any] = {}
    for key, value in payload.items():
        if key == "client_secret":
            summary[key] = "***"
            continue
        if isinstance(value, dict):
            summary[key] = {
                sub_key: type(sub_value).__name__ for sub_key, sub_value in value.items()
            }
        elif isinstance(value, list):
            summary[key] = f"list(len={len(value)})"
        else:
            summary[key] = type(value).__name__
    return summary


@router.post("/api/chatkit/session")
async def create_session(
    req: SessionRequest,
    current_user: User = Depends(get_current_user),
):
    user_id = req.user or f"user:{current_user.id}"

    session_payload = await create_chatkit_session(user_id)
    client_secret = session_payload.get("client_secret")
    if not client_secret:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit response missing client_secret",
                "details": session_payload,
            },
        )
    return {
        "client_secret": client_secret,
        "expires_after": session_payload.get("expires_after"),
    }


@router.post(
    "/api/chatkit/voice/session",
    response_model=VoiceSessionResponse,
)
async def create_voice_session(
    req: VoiceSessionRequest,
    current_user: User = Depends(get_current_user),
):
    settings = get_settings()
    resolved_model = req.model or settings.chatkit_realtime_model
    resolved_instructions = req.instructions or settings.chatkit_realtime_instructions
    resolved_voice = req.voice or settings.chatkit_realtime_voice
    user_id = f"user:{current_user.id}"

    secret_payload = await create_realtime_voice_session(
        user_id=user_id,
        model=resolved_model,
        instructions=resolved_instructions,
    )

    client_secret, expires_at = _resolve_voice_client_secret(secret_payload)
    if client_secret is None:
        summary = _summarize_payload_shape(secret_payload)
        logger.error(
            "Client secret introuvable dans la réponse Realtime : %s",
            summary,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit Realtime response missing client_secret",
                "payload_summary": summary,
            },
        )

    return VoiceSessionResponse(
        client_secret=client_secret,
        expires_at=expires_at,
        model=resolved_model,
        instructions=resolved_instructions,
        voice=resolved_voice,
    )


@router.api_route(
    "/api/chatkit/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy_chatkit(path: str, request: Request, _current_user: User = Depends(get_current_user)):
    return await proxy_chatkit_request(path, request)


@router.post("/api/chatkit")
async def chatkit_endpoint(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    try:
        from ..chatkit import ChatKitRequestContext, get_chatkit_server
    except ModuleNotFoundError as exc:  # pragma: no cover - dépendance optionnelle absente
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit SDK introuvable",
                "hint": "Installez le paquet `chatkit` ou configurez CHATKIT_WORKFLOW_ID pour utiliser cette route.",
            },
        ) from exc

    server = get_chatkit_server()
    payload = await request.body()
    context = ChatKitRequestContext(
        user_id=str(current_user.id),
        email=current_user.email,
        authorization=request.headers.get("Authorization"),
    )

    result = await server.process(payload, context)
    if isinstance(result, StreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json, media_type="application/json")
