from __future__ import annotations

from typing import TYPE_CHECKING

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

from ..chatkit_sessions import create_chatkit_session, proxy_chatkit_request
from ..dependencies import get_current_user
from ..models import User
from ..schemas import SessionRequest

router = APIRouter()


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
