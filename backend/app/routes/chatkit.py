from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any

from fastapi import (
    APIRouter,
    Depends,
    File,
    HTTPException,
    Request,
    Response,
    UploadFile,
    status,
)
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.orm import Session

try:  # pragma: no cover - dépendance optionnelle pour les tests
    from chatkit.server import StreamingResult
    from chatkit.types import (
        AssistantMessageContent,
        AssistantMessageItem,
        InferenceOptions,
        UserMessageItem,
        UserMessageTextContent,
    )
except (
    ModuleNotFoundError
):  # pragma: no cover - utilisé uniquement quand ChatKit n'est pas installé

    class StreamingResult:  # type: ignore[override]
        """Bouchon minimal utilisé lorsque le SDK ChatKit n'est pas disponible."""

        pass

    (
        AssistantMessageContent,
        AssistantMessageItem,
        InferenceOptions,
        UserMessageItem,
        UserMessageTextContent,
    ) = (None, None, None, None, None)  # type: ignore[assignment]


if TYPE_CHECKING:  # pragma: no cover - uniquement pour l'auto-complétion
    from ..chatkit import ChatKitRequestContext

try:  # pragma: no cover - dépendance optionnelle pour le SDK ChatKit
    from chatkit.store import NotFoundError
except (ModuleNotFoundError, ImportError):  # pragma: no cover - fallback sans SDK

    class NotFoundError(Exception):
        """Bouchon minimal lorsque le stockage ChatKit n'est pas disponible."""

        pass

from ..attachment_store import AttachmentUploadError
from ..chatkit_server.context import (
    _get_wait_state_metadata,
    _set_wait_state_metadata,
)
from ..chatkit_sessions import (
    SessionSecretParser,
    create_chatkit_session,
    proxy_chatkit_request,
    summarize_payload_shape,
)
from ..config import Settings, get_settings
from ..database import SessionLocal, get_session
from ..dependencies import get_current_user, get_optional_user
from ..image_utils import AGENT_IMAGE_STORAGE_DIR
from ..models import User
from ..realtime_runner import close_voice_session, open_voice_session
from ..schemas import (
    ChatKitWorkflowResponse,
    HostedWorkflowCreateRequest,
    HostedWorkflowOption,
    SessionRequest,
    VoiceSessionRequest,
    VoiceSessionResponse,
    VoiceWebRTCOfferRequest,
    VoiceWebRTCOfferResponse,
    VoiceWebRTCTeardownRequest,
    VoiceWebRTCTeardownResponse,
    VoiceWebRTCTranscript,
)
from ..security import decode_access_token, decode_agent_image_token
from ..telephony.voice_bridge import TelephonyVoiceBridge, VoiceBridgeHooks
from ..voice_settings import get_or_create_voice_settings
from ..voice_webrtc_gateway import VoiceWebRTCGateway, VoiceWebRTCGatewayError
from ..realtime_gateway import (
    GatewayConnection,
    GatewayUser,
    get_realtime_gateway,
)
from ..request_context import (
    build_chatkit_request_context,
    resolve_public_base_url_from_request,
)
from ..voice_workflow import finalize_voice_wait_state
from ..workflows import (
    HostedWorkflowConfig,
    HostedWorkflowNotFoundError,
    WorkflowService,
    WorkflowValidationError,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
    resolve_start_hosted_workflows,
)

router = APIRouter()


logger = logging.getLogger("chatkit.voice")


LEGACY_HOSTED_SLUG = "hosted-workflow"


try:  # pragma: no cover - aiortc peut être absent dans certains environnements
    from aiortc import RTCSessionDescription as AiortcRTCSessionDescription
except ImportError:  # pragma: no cover
    AiortcRTCSessionDescription = None  # type: ignore[assignment]


voice_webrtc_gateway = VoiceWebRTCGateway()


def get_chatkit_server():
    from ..chatkit import get_chatkit_server as _get_chatkit_server

    return _get_chatkit_server()


@router.get("/api/chatkit/workflow", response_model=ChatKitWorkflowResponse)
async def get_chatkit_workflow(
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> ChatKitWorkflowResponse:
    service = WorkflowService()
    definition = service.get_current(session)
    workflow = definition.workflow
    user_message = resolve_start_auto_start_message(definition)
    assistant_message = resolve_start_auto_start_assistant_message(definition)
    if user_message:
        assistant_message = ""

    return ChatKitWorkflowResponse(
        workflow_id=workflow.id if workflow else definition.workflow_id,
        workflow_slug=workflow.slug if workflow else None,
        workflow_display_name=workflow.display_name if workflow else None,
        definition_id=definition.id,
        definition_version=definition.version,
        auto_start=resolve_start_auto_start(definition),
        auto_start_user_message=user_message or None,
        auto_start_assistant_message=(
            (assistant_message or None) if not user_message else None
        ),
        updated_at=definition.updated_at,
    )


def _collect_hosted_configs(
    *,
    settings: Settings,
    definition,
    service: WorkflowService,
    session: Session,
) -> list[HostedWorkflowConfig]:
    managed_configs = list(service.list_hosted_workflow_configs(session=session))
    configs: list[HostedWorkflowConfig] = []
    seen_slugs: set[str] = set()

    for config in managed_configs:
        configs.append(config)
        seen_slugs.add(config.slug)

    for config in resolve_start_hosted_workflows(definition):
        if config.slug in seen_slugs:
            continue
        configs.append(config)
        seen_slugs.add(config.slug)

    if settings.chatkit_workflow_id and LEGACY_HOSTED_SLUG not in seen_slugs:
        configs.append(
            HostedWorkflowConfig(
                slug=LEGACY_HOSTED_SLUG,
                workflow_id=settings.chatkit_workflow_id,
                label="Hosted ChatKit workflow",
                description=None,
            )
        )

    return configs


@router.get("/api/chatkit/hosted", response_model=list[HostedWorkflowOption])
async def get_hosted_workflow_options(
    settings: Settings = Depends(get_settings),
    session: Session = Depends(get_session),
) -> list[HostedWorkflowOption]:
    service = WorkflowService()
    definition = service.get_current(session)
    configs = _collect_hosted_configs(
        settings=settings,
        definition=definition,
        service=service,
        session=session,
    )
    available = bool(settings.model_api_key and settings.model_api_base)
    return [
        HostedWorkflowOption(
            id=config.workflow_id,
            slug=config.slug,
            label=config.label,
            description=config.description,
            available=available,
            managed=config.managed,
        )
        for config in configs
    ]


@router.post(
    "/api/chatkit/hosted",
    response_model=HostedWorkflowOption,
    status_code=status.HTTP_201_CREATED,
)
async def create_hosted_workflow_entry(
    payload: HostedWorkflowCreateRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> HostedWorkflowOption:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès administrateur requis pour gérer les workflows hébergés.",
        )

    service = WorkflowService()
    try:
        entry = service.create_hosted_workflow(
            slug=payload.slug,
            workflow_id=payload.workflow_id,
            label=payload.label,
            description=payload.description,
            session=session,
        )
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc

    available = bool(settings.model_api_key and settings.model_api_base)
    return HostedWorkflowOption(
        id=entry.remote_workflow_id,
        slug=entry.slug,
        label=entry.label,
        description=entry.description,
        available=available,
        managed=True,
    )


@router.delete("/api/chatkit/hosted/{slug}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_hosted_workflow_entry(
    slug: str,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
) -> Response:
    if not current_user.is_admin:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Accès administrateur requis pour gérer les workflows hébergés.",
        )

    service = WorkflowService()
    try:
        service.delete_hosted_workflow(slug, session=session)
    except WorkflowValidationError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=exc.message,
        ) from exc
    except HostedWorkflowNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "hosted_workflow_not_found", "slug": exc.slug},
        ) from exc

    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/api/chatkit/session")
async def create_session(
    req: SessionRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
):
    user_id = req.user or f"user:{current_user.id}"
    service = WorkflowService()
    definition = service.get_current(session)
    configs = _collect_hosted_configs(
        settings=settings,
        definition=definition,
        service=service,
        session=session,
    )

    target_config: HostedWorkflowConfig | None = None
    requested_slug = req.hosted_workflow_slug
    if requested_slug:
        for config in configs:
            if config.slug == requested_slug:
                target_config = config
                break
        if target_config is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "error": "hosted_workflow_not_found",
                    "message": "Workflow hébergé introuvable pour le slug demandé.",
                    "slug": requested_slug,
                },
            )
    else:
        if configs:
            target_config = configs[0]

    if target_config is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "error": "hosted_workflow_not_configured",
                "message": "Aucun workflow hébergé n'est configuré sur le serveur.",
            },
        )

    session_secret = await create_chatkit_session(
        user_id,
        workflow_id=target_config.workflow_id,
    )
    return {
        "client_secret": session_secret["client_secret"],
        "expires_at": session_secret.get("expires_at"),
    }


@router.get("/api/chatkit/images/{image_name}")
async def get_generated_image(
    image_name: str,
    token: str | None = None,
    current_user: User | None = Depends(get_optional_user),
):
    safe_name = Path(image_name).name
    file_path = AGENT_IMAGE_STORAGE_DIR / safe_name
    if not file_path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Image introuvable",
        )
    if current_user is None:
        if not token:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentification requise",
            )
        payload = decode_agent_image_token(token)
        if payload.get("img") != safe_name:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès à l'image refusé",
            )
    elif token:
        payload = decode_agent_image_token(token)
        token_user = payload.get("sub")
        if payload.get("img") != safe_name or (
            token_user is not None and str(token_user) != str(current_user.id)
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accès à l'image refusé",
            )
    return FileResponse(file_path)


@router.post("/api/chatkit/attachments/{attachment_id}/upload")
async def upload_chatkit_attachment(
    attachment_id: str,
    request: Request,
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
):
    try:
        server = get_chatkit_server()
    except (
        ModuleNotFoundError
    ) as exc:  # pragma: no cover - dépendance optionnelle absente
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le serveur ChatKit n'est pas disponible.",
        ) from exc
    except ImportError as exc:  # pragma: no cover - dépendances du SDK incompatibles
        logger.exception(
            "Erreur lors de l'import du SDK ChatKit : %s", exc, exc_info=exc
        )
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=(
                "Le serveur ChatKit n'est pas disponible "
                "(dépendances incompatibles)."
            ),
        ) from exc

    attachment_store = getattr(server, "attachment_store", None)
    if attachment_store is None or not hasattr(attachment_store, "finalize_upload"):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="L'upload de pièces jointes n'est pas configuré sur ce serveur.",
        )

    context = build_chatkit_request_context(current_user, request)

    try:
        await attachment_store.finalize_upload(attachment_id, file, context)
    except AttachmentUploadError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pièce jointe introuvable",
        ) from exc
    except Exception as exc:  # pragma: no cover - erreurs inattendues
        logger.exception(
            "Erreur lors de l'upload de la pièce jointe %s", attachment_id, exc_info=exc
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Erreur lors de l'upload de la pièce jointe",
        ) from exc

    return {"id": attachment_id}


@router.get("/api/chatkit/attachments/{attachment_id}")
async def download_chatkit_attachment(
    attachment_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    try:
        server = get_chatkit_server()
    except (
        ModuleNotFoundError
    ) as exc:  # pragma: no cover - dépendance optionnelle absente
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pièce jointe introuvable",
        ) from exc
    except ImportError as exc:  # pragma: no cover - dépendances du SDK incompatibles
        logger.exception(
            "Erreur lors de l'import du SDK ChatKit : %s", exc, exc_info=exc
        )
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pièce jointe introuvable",
        ) from exc

    attachment_store = getattr(server, "attachment_store", None)
    if attachment_store is None or not hasattr(attachment_store, "open_attachment"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pièce jointe introuvable",
        )

    context = build_chatkit_request_context(current_user, request)

    try:
        file_path, mime_type, filename = await attachment_store.open_attachment(
            attachment_id, context
        )
    except NotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Pièce jointe introuvable",
        ) from exc

    return FileResponse(file_path, media_type=mime_type, filename=filename)


@router.post(
    "/api/chatkit/voice/session",
    response_model=VoiceSessionResponse,
)
async def create_voice_session(
    req: VoiceSessionRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    app_settings = get_settings()
    voice_settings = get_or_create_voice_settings(session)

    resolved_model = (
        req.model or voice_settings.model or app_settings.chatkit_realtime_model
    )
    resolved_instructions = (
        req.instructions
        or voice_settings.instructions
        or app_settings.chatkit_realtime_instructions
    )
    resolved_voice = (
        req.voice or voice_settings.voice or app_settings.chatkit_realtime_voice
    )
    provider_id_field_set = "model_provider_id" in req.model_fields_set
    provider_slug_field_set = "model_provider_slug" in req.model_fields_set

    if provider_id_field_set:
        resolved_provider_id_raw = req.model_provider_id
    else:
        resolved_provider_id_raw = voice_settings.provider_id

    if isinstance(resolved_provider_id_raw, str):
        resolved_provider_id = resolved_provider_id_raw.strip() or None
    else:
        resolved_provider_id = None

    if provider_slug_field_set:
        resolved_provider_slug_source = req.model_provider_slug
    elif voice_settings.provider_slug:
        resolved_provider_slug_source = voice_settings.provider_slug
    else:
        resolved_provider_slug_source = getattr(app_settings, "model_provider", None)

    trimmed_slug = (
        resolved_provider_slug_source.strip().lower()
        if isinstance(resolved_provider_slug_source, str)
        else ""
    )
    resolved_provider_slug = trimmed_slug or None

    if provider_slug_field_set and trimmed_slug and not provider_id_field_set:
        resolved_provider_id = None
    user_id = f"user:{current_user.id}"

    voice_session_handle = await open_voice_session(
        user_id=user_id,
        model=resolved_model,
        instructions=resolved_instructions,
        voice=resolved_voice,
        provider_id=resolved_provider_id,
        provider_slug=resolved_provider_slug,
    )
    secret_payload = voice_session_handle.payload

    parser = SessionSecretParser()
    parsed_secret = parser.parse(secret_payload)
    if parsed_secret.raw is None:
        summary = summarize_payload_shape(secret_payload)
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
        client_secret=parsed_secret.raw,
        expires_at=parsed_secret.expires_at_isoformat(),
        model=resolved_model,
        model_provider_id=resolved_provider_id,
        model_provider_slug=resolved_provider_slug,
        instructions=resolved_instructions,
        voice=resolved_voice,
        prompt_id=voice_settings.prompt_id,
        prompt_version=voice_settings.prompt_version,
        prompt_variables=voice_settings.prompt_variables,
    )


@router.post(
    "/api/chatkit/voice/webrtc/offer",
    response_model=VoiceWebRTCOfferResponse,
)
async def create_voice_webrtc_offer(
    req: VoiceWebRTCOfferRequest,
    current_user: User = Depends(get_current_user),
    session: Session = Depends(get_session),
):
    if AiortcRTCSessionDescription is None:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Le support WebRTC n'est pas disponible sur ce serveur.",
        )

    app_settings = get_settings()
    voice_settings = get_or_create_voice_settings(session)

    resolved_model = (
        req.model or voice_settings.model or app_settings.chatkit_realtime_model
    )
    resolved_instructions = (
        req.instructions
        or voice_settings.instructions
        or app_settings.chatkit_realtime_instructions
    )
    resolved_voice = (
        req.voice or voice_settings.voice or app_settings.chatkit_realtime_voice
    )

    provider_id_field_set = "model_provider_id" in req.model_fields_set
    provider_slug_field_set = "model_provider_slug" in req.model_fields_set

    if provider_id_field_set:
        resolved_provider_id_raw = req.model_provider_id
    else:
        resolved_provider_id_raw = voice_settings.provider_id

    if isinstance(resolved_provider_id_raw, str):
        resolved_provider_id = resolved_provider_id_raw.strip() or None
    else:
        resolved_provider_id = None

    if provider_slug_field_set:
        resolved_provider_slug_source = req.model_provider_slug
    elif voice_settings.provider_slug:
        resolved_provider_slug_source = voice_settings.provider_slug
    else:
        resolved_provider_slug_source = getattr(app_settings, "model_provider", None)

    trimmed_slug = (
        resolved_provider_slug_source.strip().lower()
        if isinstance(resolved_provider_slug_source, str)
        else ""
    )
    resolved_provider_slug = trimmed_slug or None

    if provider_slug_field_set and trimmed_slug and not provider_id_field_set:
        resolved_provider_id = None

    user_id = f"user:{current_user.id}"

    voice_session_handle = await open_voice_session(
        user_id=user_id,
        model=resolved_model,
        instructions=resolved_instructions,
        voice=resolved_voice,
        provider_id=resolved_provider_id,
        provider_slug=resolved_provider_slug,
    )
    secret_payload = voice_session_handle.payload

    parser = SessionSecretParser()
    parsed_secret = parser.parse(secret_payload)
    client_secret = parsed_secret.as_text()
    if not client_secret:
        summary = summarize_payload_shape(secret_payload)
        logger.error(
            "Client secret introuvable pour la passerelle WebRTC : %s",
            summary,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit Realtime response missing client_secret",
                "payload_summary": summary,
            },
        )

    try:
        offer = AiortcRTCSessionDescription(sdp=req.offer.sdp, type=req.offer.type)
    except Exception as exc:  # pragma: no cover
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Invalid WebRTC offer", "message": str(exc)},
        ) from exc

    bridge = TelephonyVoiceBridge(hooks=VoiceBridgeHooks(), input_codec="pcm")

    try:
        session_obj, answer = await voice_webrtc_gateway.create_session(
            bridge=bridge,
            client_secret=client_secret,
            offer=offer,
            model=resolved_model,
            instructions=resolved_instructions,
            voice=resolved_voice,
            api_base=None,
        )
    except VoiceWebRTCGatewayError as exc:
        logger.exception("Échec de la création de la session WebRTC voix", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": str(exc)},
        ) from exc

    return VoiceWebRTCOfferResponse(
        session_id=session_obj.session_id,
        answer={"type": answer.type, "sdp": answer.sdp},
        expires_at=parsed_secret.expires_at_isoformat(),
    )


@router.post(
    "/api/chatkit/voice/webrtc/teardown",
    response_model=VoiceWebRTCTeardownResponse,
)
async def teardown_voice_webrtc_session(
    req: VoiceWebRTCTeardownRequest,
    current_user: User = Depends(get_current_user),
):
    try:
        result = await voice_webrtc_gateway.teardown(req.session_id)
    except VoiceWebRTCGatewayError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": str(exc)},
        ) from exc

    stats = result.stats
    transcripts: list[VoiceWebRTCTranscript] = []
    if stats and isinstance(stats.transcripts, list):
        for index, entry in enumerate(stats.transcripts):
            if not isinstance(entry, dict):
                continue
            text = str(entry.get("text") or "").strip()
            if not text:
                continue
            role_raw = str(entry.get("role") or "assistant").strip().lower()
            role = "user" if role_raw == "user" else "assistant"
            status_value = str(entry.get("status") or "completed").strip().lower()
            allowed_status = {"completed", "in_progress", "incomplete"}
            normalized_status = (
                status_value if status_value in allowed_status else "completed"
            )
            transcript_id = entry.get("id")
            if isinstance(transcript_id, str) and transcript_id.strip():
                identifier = transcript_id.strip()
            else:
                identifier = f"{req.session_id}-{index}" if index else req.session_id
            transcripts.append(
                VoiceWebRTCTranscript(
                    id=identifier,
                    role=role,
                    text=text,
                    status=normalized_status,
                )
            )

    stats_payload: dict[str, float | int] = {}
    error_message: str | None = None
    if stats is not None:
        stats_payload = {
            "duration_seconds": stats.duration_seconds,
            "inbound_audio_bytes": stats.inbound_audio_bytes,
            "outbound_audio_bytes": stats.outbound_audio_bytes,
            "transcript_count": stats.transcript_count,
        }
        if stats.error is not None:
            error_message = str(stats.error)

    if result.error is not None and not error_message:
        error_message = str(result.error)

    return VoiceWebRTCTeardownResponse(
        session_id=req.session_id,
        closed=True,
        transcripts=transcripts,
        error=error_message,
        stats=stats_payload,
    )


@router.websocket("/api/chatkit/voice/realtime")
async def realtime_voice_gateway_endpoint(websocket: WebSocket) -> None:
    token = websocket.query_params.get("token")
    if isinstance(token, str):
        token = token.strip()
    else:
        auth_header = websocket.headers.get("authorization")
        if isinstance(auth_header, str) and auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()
        else:
            token = ""

    if token.lower().startswith("bearer "):
        token = token[7:].strip()

    if not token:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    try:
        payload = decode_access_token(token)
        user_sub = payload.get("sub")
        user_id = int(user_sub)
    except Exception:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    with SessionLocal() as session:
        user = session.get(User, user_id)

    if user is None:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    await websocket.accept()

    connection = GatewayConnection(
        websocket=websocket,
        user=GatewayUser(id=str(user.id), email=user.email),
        authorization=f"Bearer {token}",
    )

    gateway = get_realtime_gateway()
    await gateway.serve(connection)


@router.get("/api/chatkit/voice/pending/{thread_id}")
async def get_pending_voice_session(
    thread_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Récupère une session vocale en attente pour le thread donné."""
    try:
        server = get_chatkit_server()
    except (ModuleNotFoundError, ImportError) as exc:
        logger.error("SDK ChatKit introuvable", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "ChatKit SDK introuvable"},
        ) from exc

    # Créer le context pour le store
    context = build_chatkit_request_context(current_user, request)

    try:
        # Charger le thread depuis le store
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        ) from None
    except Exception as exc:
        logger.exception("Erreur lors de la récupération du thread", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la récupération du thread"},
        ) from exc

    # Récupérer le wait_state metadata
    wait_state = _get_wait_state_metadata(thread)

    if not wait_state:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Aucune session en attente"},
        )

    # Vérifier si c'est une session vocale
    if wait_state.get("type") != "voice":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Aucune session vocale en attente"},
        )

    # Récupérer l'événement voice
    voice_event = wait_state.get("voice_event")
    if not voice_event:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Événement vocal introuvable"},
        )

    # Vérifier si l'événement a déjà été consommé
    if wait_state.get("voice_event_consumed"):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Session vocale déjà démarrée"},
        )

    # Marquer l'événement comme consommé pour éviter les redémarrages
    updated_wait_state = dict(wait_state)
    updated_wait_state["voice_event_consumed"] = True
    _set_wait_state_metadata(thread, updated_wait_state)

    # Sauvegarder le thread avec les métadonnées mises à jour
    try:
        await server.store.save_thread(thread, context)
    except Exception as exc:
        logger.exception("Erreur lors de la sauvegarde du thread", exc_info=exc)
        # Continue quand même pour ne pas bloquer le démarrage de la session

    logger.info(
        "Session vocale en attente récupérée (user=%s, thread=%s)",
        current_user.id,
        thread_id,
    )

    return voice_event


@router.post("/api/chatkit/voice/transcripts/{thread_id}")
async def submit_voice_transcripts(
    thread_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Ajoute des transcriptions vocales en temps réel sans relancer le workflow."""
    try:
        server = get_chatkit_server()
    except (ModuleNotFoundError, ImportError) as exc:
        logger.error("SDK ChatKit introuvable", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "ChatKit SDK introuvable"},
        ) from exc

    # Récupérer les transcriptions du body
    try:
        body = await request.json()
        transcripts = body.get("transcripts", [])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Corps de requête invalide"},
        ) from exc

    # Créer le context pour le store
    context = build_chatkit_request_context(current_user, request)

    try:
        # Charger le thread depuis le store
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        ) from None
    except Exception as exc:
        logger.exception("Erreur lors de la récupération du thread", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la récupération du thread"},
        ) from exc

    # Vérifier qu'une session vocale est active
    wait_state = _get_wait_state_metadata(thread)
    if not wait_state or wait_state.get("type") != "voice":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Aucune session vocale en attente"},
        )

    if not all(
        (
            AssistantMessageContent,
            AssistantMessageItem,
            InferenceOptions,
            UserMessageItem,
            UserMessageTextContent,
        )
    ):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"error": "ChatKit SDK incomplet: types de messages indisponibles"},
        )

    existing_transcripts_raw = wait_state.get("voice_transcripts")
    existing_transcripts: list[dict[str, Any]] = []
    if isinstance(existing_transcripts_raw, list):
        for entry in existing_transcripts_raw:
            if isinstance(entry, dict):
                existing_transcripts.append(dict(entry))

    index_by_message_id: dict[str, int] = {}
    for idx, entry in enumerate(existing_transcripts):
        message_id = entry.get("message_id") or entry.get("id")
        if isinstance(message_id, str) and message_id.strip():
            index_by_message_id[message_id.strip()] = idx

    messages_added = 0
    messages_updated = 0
    wait_state_changed = False

    for transcript in transcripts:
        if not isinstance(transcript, dict):
            continue

        role_raw = transcript.get("role")
        text_raw = transcript.get("text")
        if not isinstance(role_raw, str) or not isinstance(text_raw, str):
            continue

        normalized_role = role_raw.strip().lower()
        text = text_raw.strip()
        if not text or normalized_role not in {"user", "assistant"}:
            continue

        status_raw = transcript.get("status")
        normalized_status = status_raw.strip() if isinstance(status_raw, str) else None

        transcript_id_raw = transcript.get("id")
        transcript_id = (
            transcript_id_raw.strip()
            if isinstance(transcript_id_raw, str) and transcript_id_raw.strip()
            else None
        )

        message_id_raw = transcript.get("message_id")
        message_id = (
            message_id_raw.strip()
            if isinstance(message_id_raw, str) and message_id_raw.strip()
            else None
        )

        if not message_id:
            if transcript_id:
                message_id = f"voice_{transcript_id}"
            else:
                message_id = f"voice_{thread_id}_{uuid.uuid4()}"

        if not transcript_id:
            transcript_id = message_id

        wait_state_entry: dict[str, Any] = dict(transcript)
        wait_state_entry["id"] = transcript_id
        wait_state_entry["message_id"] = message_id
        wait_state_entry["role"] = normalized_role
        wait_state_entry["text"] = text
        if normalized_status:
            wait_state_entry["status"] = normalized_status
        elif "status" in wait_state_entry:
            del wait_state_entry["status"]

        existing_index = index_by_message_id.get(message_id)
        existing_entry = (
            existing_transcripts[existing_index] if existing_index is not None else None
        )

        existing_text = (
            existing_entry.get("text").strip()
            if isinstance(existing_entry, dict)
            and isinstance(existing_entry.get("text"), str)
            else None
        )
        existing_status = (
            existing_entry.get("status").strip()
            if isinstance(existing_entry, dict)
            and isinstance(existing_entry.get("status"), str)
            else None
        )

        requires_message_update = (
            existing_entry is None
            or existing_text != text
            or (existing_status or None) != (normalized_status or None)
        )

        now = datetime.now(timezone.utc)

        if requires_message_update:
            try:
                if existing_entry is None:
                    if normalized_role == "user":
                        user_message = UserMessageItem(
                            id=message_id,
                            thread_id=thread_id,
                            created_at=now,
                            content=[UserMessageTextContent(text=text)],
                            attachments=[],
                            inference_options=InferenceOptions(),
                            quoted_text=None,
                        )
                        await server.store.add_thread_item(
                            thread_id,
                            user_message,
                            context,
                        )
                    else:
                        assistant_message = AssistantMessageItem(
                            id=message_id,
                            thread_id=thread_id,
                            created_at=now,
                            content=[AssistantMessageContent(text=text)],
                        )
                        await server.store.add_thread_item(
                            thread_id, assistant_message, context
                        )
                    messages_added += 1
                else:
                    try:
                        existing_item = await server.store.load_item(
                            thread_id, message_id, context
                        )
                    except NotFoundError:
                        existing_item = None

                    created_at = (
                        existing_item.created_at
                        if existing_item is not None
                        else now
                    )

                    if normalized_role == "user":
                        user_message = UserMessageItem(
                            id=message_id,
                            thread_id=thread_id,
                            created_at=created_at,
                            content=[UserMessageTextContent(text=text)],
                            attachments=[],
                            inference_options=InferenceOptions(),
                            quoted_text=None,
                        )
                        if existing_item is None:
                            await server.store.add_thread_item(
                                thread_id, user_message, context
                            )
                            messages_added += 1
                        else:
                            await server.store.save_item(
                                thread_id,
                                user_message,
                                context,
                            )
                            messages_updated += 1
                    else:
                        assistant_message = AssistantMessageItem(
                            id=message_id,
                            thread_id=thread_id,
                            created_at=created_at,
                            content=[AssistantMessageContent(text=text)],
                        )
                        if existing_item is None:
                            await server.store.add_thread_item(
                                thread_id, assistant_message, context
                            )
                            messages_added += 1
                        else:
                            await server.store.save_item(
                                thread_id,
                                assistant_message,
                                context,
                            )
                            messages_updated += 1
            except Exception as exc:
                logger.exception(
                    "Erreur lors de la synchronisation des transcriptions vocales",
                    exc_info=exc,
                )
                raise HTTPException(
                    status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                    detail={
                        "error": "Erreur lors de la synchronisation des transcriptions"
                    },
                ) from exc

        if existing_index is not None:
            if existing_entry != wait_state_entry:
                wait_state_changed = True
                existing_transcripts[existing_index] = wait_state_entry
        else:
            wait_state_changed = True
            index_by_message_id[message_id] = len(existing_transcripts)
            existing_transcripts.append(wait_state_entry)

    updated_wait_state = dict(wait_state)
    previous_transcripts_present = bool(wait_state.get("voice_transcripts"))
    previous_messages_created = bool(wait_state.get("voice_messages_created"))
    next_transcripts_present = bool(existing_transcripts)
    next_messages_created = next_transcripts_present

    if (
        wait_state_changed
        or next_transcripts_present != previous_transcripts_present
        or next_messages_created != previous_messages_created
    ):
        updated_wait_state["voice_transcripts"] = existing_transcripts
        updated_wait_state["voice_messages_created"] = next_messages_created
        _set_wait_state_metadata(thread, updated_wait_state)
        try:
            await server.store.save_thread(thread, context)
        except Exception as exc:
            logger.exception(
                "Erreur lors de la sauvegarde des métadonnées de transcription",
                exc_info=exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Erreur lors de la mise à jour des métadonnées"},
            ) from exc

    if messages_added or messages_updated:
        logger.info(
            "Transcriptions synchronisées (user=%s, thread=%s, ajoutées=%d, mises à "
            "jour=%d)",
            current_user.id,
            thread_id,
            messages_added,
            messages_updated,
        )

    return {
        "status": "ok",
        "messages_added": messages_added,
        "messages_updated": messages_updated,
    }


@router.post("/api/chatkit/voice/finalize/{thread_id}")
async def finalize_voice_session(
    thread_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Finalise la session vocale et relance le workflow si nécessaire."""
    try:
        get_chatkit_server()
    except (ModuleNotFoundError, ImportError) as exc:
        logger.error("SDK ChatKit introuvable", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "ChatKit SDK introuvable"},
        ) from exc

    try:
        body = await request.json()
        transcripts = body.get("transcripts", [])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Corps de requête invalide"},
        ) from exc

    context = build_chatkit_request_context(current_user, request)

    await finalize_voice_wait_state(
        thread_id=thread_id,
        transcripts=transcripts,
        context=context,
        current_user=current_user,
    )

    return {"status": "ok"}


@router.api_route(
    "/api/chatkit/proxy/{path:path}",
    methods=["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"],
)
async def proxy_chatkit(
    path: str, request: Request, _current_user: User = Depends(get_current_user)
):
    return await proxy_chatkit_request(path, request)


@router.post("/api/chatkit")
async def chatkit_endpoint(
    request: Request,
    current_user: User = Depends(get_current_user),
):
    try:
        server = get_chatkit_server()
    except (
        ModuleNotFoundError
    ) as exc:  # pragma: no cover - dépendance optionnelle absente
        logger.error(
            "SDK ChatKit introuvable : installez le paquet `chatkit` ou configurez"
            " CHATKIT_WORKFLOW_ID pour utiliser cette route.",
            exc_info=exc,
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "ChatKit SDK introuvable",
                "hint": (
                    "Installez le paquet `chatkit` ou configurez "
                    "CHATKIT_WORKFLOW_ID pour utiliser cette route."
                ),
            },
        ) from exc
    except ImportError as exc:  # pragma: no cover - dépendances du SDK incompatibles
        logger.exception(
            "Erreur lors de l'import du SDK ChatKit : %s", exc, exc_info=exc
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={
                "error": "Import du SDK ChatKit impossible",
                "hint": (
                    "Mettez à jour le paquet `chatkit` afin de disposer d'une "
                    "version compatible."
                ),
                "details": str(exc),
            },
        ) from exc

    payload = await request.body()
    payload_length = len(payload)
    content_type = request.headers.get("content-type") or "<inconnu>"

    settings = get_settings()
    resolved_from_request = resolve_public_base_url_from_request(request)
    if resolved_from_request and not settings.backend_public_base_url_from_env:
        base_url = resolved_from_request
    else:
        base_url = settings.backend_public_base_url

    logger.info(
        "Requête ChatKit reçue (user=%s, base_url=%s, content_type=%s, payload=%d o)",
        current_user.id,
        base_url or "<non défini>",
        content_type,
        payload_length,
    )

    context = build_chatkit_request_context(
        current_user,
        request,
        public_base_url=base_url,
    )

    try:
        result = await server.process(payload, context)
    except Exception as exc:
        logger.exception(
            "Erreur lors du traitement ChatKit (user=%s, payload=%d o)",
            current_user.id,
            payload_length,
            exc_info=exc,
        )
        raise

    logger.info(
        "Réponse ChatKit générée (user=%s, streaming=%s)",
        current_user.id,
        isinstance(result, StreamingResult),
    )

    if isinstance(result, StreamingResult):
        return StreamingResponse(result, media_type="text/event-stream")
    return Response(content=result.json, media_type="application/json")
