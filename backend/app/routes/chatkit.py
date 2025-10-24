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

    AssistantMessageContent = AssistantMessageItem = InferenceOptions = UserMessageItem = UserMessageTextContent = None  # type: ignore[assignment]


if TYPE_CHECKING:  # pragma: no cover - uniquement pour l'auto-complétion
    from ..chatkit import ChatKitRequestContext

from chatkit.store import NotFoundError

from ..attachment_store import AttachmentUploadError
from ..chatkit_realtime import create_realtime_voice_session
from ..chatkit_sessions import (
    SessionSecretParser,
    create_chatkit_session,
    proxy_chatkit_request,
    summarize_payload_shape,
)
from ..chatkit_server.context import (
    _get_wait_state_metadata,
    _set_wait_state_metadata,
)
from ..config import get_settings
from ..database import get_session
from ..dependencies import get_current_user, get_optional_user
from ..image_utils import AGENT_IMAGE_STORAGE_DIR
from ..models import User
from ..schemas import (
    ChatKitWorkflowResponse,
    SessionRequest,
    VoiceSessionRequest,
    VoiceSessionResponse,
)
from ..security import decode_agent_image_token
from ..voice_settings import get_or_create_voice_settings
from ..workflows import (
    WorkflowService,
    resolve_start_auto_start,
    resolve_start_auto_start_assistant_message,
    resolve_start_auto_start_message,
)

router = APIRouter()


logger = logging.getLogger("chatkit.voice")


def get_chatkit_server():
    from ..chatkit import get_chatkit_server as _get_chatkit_server

    return _get_chatkit_server()


def _build_request_context(
    current_user: User,
    request: Request | None,
    *,
    public_base_url: str | None = None,
) -> ChatKitRequestContext:
    from ..chatkit import ChatKitRequestContext

    base_url = (
        public_base_url
        if public_base_url is not None
        else (_resolve_public_base_url_from_request(request) if request else None)
    )
    authorization = request.headers.get("Authorization") if request else None
    return ChatKitRequestContext(
        user_id=str(current_user.id),
        email=current_user.email,
        authorization=authorization,
        public_base_url=base_url,
    )


def _resolve_public_base_url_from_request(request: Request) -> str | None:
    """Détermine l'URL publique à partir des en-têtes de la requête."""

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


@router.post("/api/chatkit/session")
async def create_session(
    req: SessionRequest,
    current_user: User = Depends(get_current_user),
):
    user_id = req.user or f"user:{current_user.id}"

    session_secret = await create_chatkit_session(user_id)
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

    context = _build_request_context(current_user, request)

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

    context = _build_request_context(current_user, request)

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
    user_id = f"user:{current_user.id}"

    secret_payload = await create_realtime_voice_session(
        user_id=user_id,
        model=resolved_model,
        instructions=resolved_instructions,
    )

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
        instructions=resolved_instructions,
        voice=resolved_voice,
        prompt_id=voice_settings.prompt_id,
        prompt_version=voice_settings.prompt_version,
        prompt_variables=voice_settings.prompt_variables,
    )


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
    context = _build_request_context(current_user, request)

    try:
        # Charger le thread depuis le store
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        )
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
    """Ajoute des transcriptions vocales au thread en temps réel (sans déclencher la continuation du workflow)."""
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
    context = _build_request_context(current_user, request)

    try:
        # Charger le thread depuis le store
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        )
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

    # Créer les messages directement dans le thread et accumuler les transcriptions
    messages_added = 0
    new_wait_state_transcripts: list[dict[str, Any]] = []
    for transcript in transcripts:
        if not isinstance(transcript, dict):
            continue

        role_raw = transcript.get("role")
        if isinstance(role_raw, str):
            normalized_role = role_raw.strip().lower()
        else:
            normalized_role = ""

        text_raw = transcript.get("text")
        text = text_raw.strip() if isinstance(text_raw, str) else ""
        if not text or normalized_role not in {"user", "assistant"}:
            continue

        status_raw = transcript.get("status")
        normalized_status = status_raw.strip() if isinstance(status_raw, str) else None

        now = datetime.now(timezone.utc)
        item_id = f"msg_{uuid.uuid4()}"

        wait_state_entry: dict[str, Any] = {
            key: value for key, value in transcript.items() if key not in {"role", "text"}
        }
        wait_state_entry["role"] = normalized_role
        wait_state_entry["text"] = text
        if normalized_status:
            wait_state_entry["status"] = normalized_status
        elif "status" in wait_state_entry:
            del wait_state_entry["status"]

        if normalized_role == "user":
            user_message = UserMessageItem(
                id=item_id,
                thread_id=thread_id,
                created_at=now,
                content=[UserMessageTextContent(text=text)],
                attachments=[],
                inference_options=InferenceOptions(),
                quoted_text=None,
            )
            await server.store.add_thread_item(thread_id, user_message, context)
        else:
            assistant_message = AssistantMessageItem(
                id=item_id,
                thread_id=thread_id,
                created_at=now,
                content=[AssistantMessageContent(text=text)],
            )
            await server.store.add_thread_item(thread_id, assistant_message, context)

        messages_added += 1
        new_wait_state_transcripts.append(wait_state_entry)

    if new_wait_state_transcripts:
        existing_transcripts = wait_state.get("voice_transcripts")
        accumulated: list[dict[str, Any]] = []
        if isinstance(existing_transcripts, list):
            for entry in existing_transcripts:
                if not isinstance(entry, dict):
                    continue
                role_entry = entry.get("role")
                text_entry = entry.get("text")
                status_entry = entry.get("status")
                if not isinstance(role_entry, str) or not isinstance(text_entry, str):
                    continue
                normalized_entry: dict[str, Any] = dict(entry)
                normalized_entry["role"] = role_entry.strip().lower()
                normalized_entry["text"] = text_entry.strip()
                if isinstance(status_entry, str) and status_entry.strip():
                    normalized_entry["status"] = status_entry.strip()
                elif "status" in normalized_entry:
                    del normalized_entry["status"]
                accumulated.append(normalized_entry)

        accumulated.extend(new_wait_state_transcripts)
        updated_wait_state = dict(wait_state)
        updated_wait_state["voice_transcripts"] = accumulated
        _set_wait_state_metadata(thread, updated_wait_state)

        try:
            await server.store.save_thread(thread, context)
        except Exception as exc:
            logger.exception(
                "Erreur lors de la sauvegarde des métadonnées de transcription", exc_info=exc
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Erreur lors de la mise à jour des métadonnées"},
            ) from exc

    if messages_added > 0:
        logger.info(
            "Transcriptions ajoutées au thread (user=%s, thread=%s, messages=%d)",
            current_user.id,
            thread_id,
            messages_added,
        )

    return {"status": "ok", "messages_added": messages_added}


@router.post("/api/chatkit/voice/finalize/{thread_id}")
async def finalize_voice_session(
    thread_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
):
    """Finalise la session vocale avec les transcriptions et déclenche la continuation du workflow."""
    try:
        server = get_chatkit_server()
    except (ModuleNotFoundError, ImportError) as exc:
        logger.error("SDK ChatKit introuvable", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "ChatKit SDK introuvable"},
        ) from exc

    # Récupérer les transcriptions du body (peut être vide si déjà envoyées via /transcripts)
    try:
        body = await request.json()
        transcripts = body.get("transcripts", [])
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"error": "Corps de requête invalide"},
        ) from exc

    # Créer le context pour le store
    context = _build_request_context(current_user, request)

    try:
        # Charger le thread depuis le store
        thread = await server.store.load_thread(thread_id, context)
    except NotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Thread introuvable"},
        )
    except Exception as exc:
        logger.exception("Erreur lors de la récupération du thread", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la récupération du thread"},
        ) from exc

    # Récupérer le wait_state metadata
    wait_state = _get_wait_state_metadata(thread)

    if not wait_state or wait_state.get("type") != "voice":
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail={"error": "Aucune session vocale en attente"},
        )

    # Marquer que les messages vocaux ont déjà été créés (via /transcripts)
    # Le workflow ne devra donc pas les créer à nouveau
    updated_wait_state = dict(wait_state)
    updated_wait_state["voice_messages_created"] = True
    if transcripts:
        # Si des transcriptions sont quand même envoyées (pour retrocompatibilité), les stocker
        updated_wait_state["voice_transcripts"] = transcripts
    _set_wait_state_metadata(thread, updated_wait_state)

    # Sauvegarder le thread avec les transcriptions
    try:
        await server.store.save_thread(thread, context)
    except Exception as exc:
        logger.exception("Erreur lors de la sauvegarde des transcriptions", exc_info=exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"error": "Erreur lors de la sauvegarde des transcriptions"},
        ) from exc

    logger.info(
        "Finalisation de la session vocale (user=%s, thread=%s)",
        current_user.id,
        thread_id,
    )

    # Déclencher la continuation du workflow avec un message vide
    # Cela forcera le workflow à réévaluer le wait_state et continuer
    post_callable = getattr(server, "post", None)
    if callable(post_callable):
        try:
            await post_callable(
                {
                    "type": "user_message",
                    "thread_id": thread_id,
                    "message": {"content": []},
                },
                context,
            )
        except Exception as exc:
            logger.warning(
                "Échec du déclenchement de la continuation du workflow",
                exc_info=exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Erreur lors de la continuation du workflow"},
            ) from exc
    else:
        resume_request = {
            "type": "threads.add_user_message",
            "params": {
                "thread_id": thread_id,
                "input": {
                    "content": [],
                    "attachments": [],
                    "quoted_text": None,
                    "inference_options": {},
                },
            },
        }
        try:
            result = await server.process(json.dumps(resume_request), context)
            if isinstance(result, StreamingResult):
                async for _ in result:
                    pass
        except Exception as exc:
            logger.warning(
                "Impossible de reprendre le workflow via ChatKitServer.process pour le thread %s",
                thread_id,
                exc_info=exc,
            )
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail={"error": "Erreur lors de la continuation du workflow"},
            ) from exc

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
    resolved_from_request = _resolve_public_base_url_from_request(request)
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

    context = _build_request_context(
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
