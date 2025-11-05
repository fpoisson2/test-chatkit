"""Routes API pour les appels sortants."""

from __future__ import annotations

import asyncio
import base64
import json
import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin, get_current_user
from ..models import OutboundCall, SipAccount, User, WorkflowDefinition
from ..telephony.outbound_call_manager import get_outbound_call_manager
from ..telephony.audio_stream_manager import get_audio_stream_manager

logger = logging.getLogger("chatkit.routes.outbound")

router = APIRouter()


class InitiateCallRequest(BaseModel):
    """Requête pour initier un appel sortant."""

    to_number: str
    voice_workflow_id: int
    sip_account_id: int | None = None
    metadata: dict[str, Any] | None = None


class CallStatusResponse(BaseModel):
    """Réponse avec le statut d'un appel."""

    call_id: str
    status: str
    to_number: str
    from_number: str
    queued_at: str | None
    answered_at: str | None
    ended_at: str | None
    duration_seconds: int | None
    failure_reason: str | None


class CallListItem(BaseModel):
    """Item d'appel dans une liste."""

    call_id: str
    to_number: str
    status: str
    queued_at: str | None
    duration_seconds: int | None


class CallListResponse(BaseModel):
    """Réponse de liste d'appels."""

    total: int
    calls: list[CallListItem]


@router.post("/api/outbound/call")
async def initiate_single_call(
    request: InitiateCallRequest,
    db: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    """
    Initie un appel sortant immédiat (usage API direct).

    Args:
        request: Configuration de l'appel
        db: Session de base de données
        _: Utilisateur admin (requis)

    Returns:
        Informations sur l'appel initié

    Raises:
        HTTPException: Si validation échoue ou erreur d'initiation
    """
    # Valider le workflow
    workflow = db.query(WorkflowDefinition).filter_by(id=request.voice_workflow_id).first()
    if not workflow:
        raise HTTPException(status_code=404, detail="Workflow not found")

    # Récupérer ou utiliser le compte SIP par défaut
    sip_account_id = request.sip_account_id
    if not sip_account_id:
        sip_account = db.query(SipAccount).filter_by(
            is_default=True, is_active=True
        ).first()
        if not sip_account:
            raise HTTPException(
                status_code=400, detail="No default SIP account configured"
            )
        sip_account_id = sip_account.id
    else:
        sip_account = db.query(SipAccount).filter_by(id=sip_account_id).first()
        if not sip_account:
            raise HTTPException(status_code=404, detail="SIP account not found")

    from_number = sip_account.contact_host or "unknown"

    # Initier l'appel
    try:
        outbound_manager = get_outbound_call_manager()
        call_session = await outbound_manager.initiate_call(
            db=db,
            to_number=request.to_number,
            from_number=from_number,
            workflow_id=request.voice_workflow_id,
            sip_account_id=sip_account_id,
            metadata=request.metadata or {},
        )

        return {
            "call_id": call_session.call_id,
            "status": call_session.status,
            "to_number": request.to_number,
        }
    except Exception as e:
        logger.error("Failed to initiate outbound call: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/api/outbound/call/{call_id}")
async def get_call_status(
    call_id: str,
    db: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> CallStatusResponse:
    """
    Récupère le statut d'un appel sortant.

    Args:
        call_id: ID de l'appel
        db: Session de base de données
        _: Utilisateur admin (requis)

    Returns:
        Statut et métriques de l'appel

    Raises:
        HTTPException: Si l'appel n'est pas trouvé
    """
    call = db.query(OutboundCall).filter_by(call_sid=call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    return CallStatusResponse(
        call_id=call.call_sid,
        status=call.status,
        to_number=call.to_number,
        from_number=call.from_number,
        queued_at=call.queued_at.isoformat() if call.queued_at else None,
        answered_at=call.answered_at.isoformat() if call.answered_at else None,
        ended_at=call.ended_at.isoformat() if call.ended_at else None,
        duration_seconds=call.duration_seconds,
        failure_reason=call.failure_reason,
    )


@router.post("/api/outbound/call/{call_id}/hangup")
async def hangup_call(
    call_id: str,
    current_user: User = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Raccroche un appel en cours.

    Args:
        call_id: ID de l'appel
        current_user: Utilisateur authentifié (requis)

    Returns:
        Message de confirmation

    Raises:
        HTTPException: Si l'appel n'est pas trouvé
    """
    call_manager = get_outbound_call_manager()
    success = await call_manager.hangup_call(call_id)

    if not success:
        raise HTTPException(status_code=404, detail="Call not found or already ended")

    return {"message": "Call hung up successfully", "call_id": call_id}


@router.get("/api/outbound/calls")
async def list_outbound_calls(
    skip: int = 0,
    limit: int = 50,
    status: str | None = None,
    db: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> CallListResponse:
    """
    Liste les appels sortants récents.

    Args:
        skip: Nombre d'appels à sauter (pagination)
        limit: Nombre maximum d'appels à retourner
        status: Filtrer par statut (optionnel)
        db: Session de base de données
        _: Utilisateur admin (requis)

    Returns:
        Liste d'appels avec pagination
    """
    query = db.query(OutboundCall)

    if status:
        query = query.filter_by(status=status)

    total = query.count()
    calls = query.order_by(OutboundCall.queued_at.desc()).offset(skip).limit(limit).all()

    return CallListResponse(
        total=total,
        calls=[
            CallListItem(
                call_id=c.call_sid,
                to_number=c.to_number,
                status=c.status,
                queued_at=c.queued_at.isoformat() if c.queued_at else None,
                duration_seconds=c.duration_seconds,
            )
            for c in calls
        ],
    )


@router.get("/api/outbound/call/{call_id}/audio/{audio_type}")
async def get_call_audio(
    call_id: str,
    audio_type: str,
    db: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> FileResponse:
    """
    Télécharge un fichier audio d'un appel sortant.

    Args:
        call_id: ID de l'appel
        audio_type: Type d'audio ('inbound', 'outbound', ou 'mixed')
        db: Session de base de données
        _: Utilisateur admin (requis)

    Returns:
        Fichier audio WAV

    Raises:
        HTTPException: Si l'appel ou le fichier audio n'est pas trouvé
    """
    # Valider le type d'audio
    if audio_type not in ('inbound', 'outbound', 'mixed'):
        raise HTTPException(
            status_code=400,
            detail="Invalid audio type. Must be 'inbound', 'outbound', or 'mixed'"
        )

    # Récupérer l'appel
    call = db.query(OutboundCall).filter_by(call_sid=call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    # Récupérer le chemin du fichier audio depuis les métadonnées
    metadata = call.metadata_ or {}
    audio_recordings = metadata.get("audio_recordings", {})

    if not audio_recordings:
        raise HTTPException(
            status_code=404,
            detail="No audio recordings available for this call"
        )

    audio_path = audio_recordings.get(audio_type)
    if not audio_path:
        raise HTTPException(
            status_code=404,
            detail=f"No {audio_type} audio recording available for this call"
        )

    # Vérifier que le fichier existe
    if not os.path.exists(audio_path):
        logger.error("Audio file not found on disk: %s", audio_path)
        raise HTTPException(
            status_code=404,
            detail="Audio file not found on disk"
        )

    # Retourner le fichier
    filename = Path(audio_path).name
    return FileResponse(
        path=audio_path,
        media_type="audio/wav",
        filename=filename,
        headers={
            "Content-Disposition": f'attachment; filename="{filename}"',
            "Cache-Control": "public, max-age=3600"
        }
    )


@router.get("/api/outbound/call/{call_id}/transcripts")
async def get_call_transcripts(
    call_id: str,
    db: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> dict[str, Any]:
    """
    Récupère les transcriptions d'un appel sortant.

    Args:
        call_id: ID de l'appel
        db: Session de base de données
        _: Utilisateur admin (requis)

    Returns:
        Transcriptions de l'appel

    Raises:
        HTTPException: Si l'appel n'est pas trouvé
    """
    # Récupérer l'appel
    call = db.query(OutboundCall).filter_by(call_sid=call_id).first()
    if not call:
        raise HTTPException(status_code=404, detail="Call not found")

    # Récupérer les transcriptions depuis les métadonnées
    metadata = call.metadata_ or {}
    transcripts = metadata.get("transcripts", [])
    audio_recordings = metadata.get("audio_recordings", {})

    return {
        "call_id": call_id,
        "transcripts": transcripts,
        "audio_recordings": audio_recordings,
        "status": call.status,
        "duration_seconds": call.duration_seconds,
    }


@router.websocket("/api/outbound/call/{call_id}/audio/stream")
async def stream_call_audio(websocket: WebSocket, call_id: str):
    """
    Stream audio en temps réel d'un appel sortant via WebSocket.

    Le client reçoit des paquets JSON avec :
    - type: "audio" pour les chunks audio
    - channel: "inbound", "outbound" ou "mixed"
    - data: Audio PCM encodé en base64
    - timestamp: Timestamp du paquet

    Args:
        websocket: Connexion WebSocket
        call_id: ID de l'appel
    """
    await websocket.accept()
    audio_stream_mgr = get_audio_stream_manager()
    queue = None

    try:
        # Enregistrer le listener
        queue = await audio_stream_mgr.register_listener(call_id)
        logger.info("WebSocket client connected for call %s audio stream", call_id)

        # Envoyer un message de confirmation
        await websocket.send_json({
            "type": "connected",
            "call_id": call_id,
            "message": "Audio stream started"
        })

        # Boucle d'envoi des packets audio
        while True:
            try:
                # Attendre un paquet avec timeout
                packet = await asyncio.wait_for(queue.get(), timeout=30.0)

                if packet["type"] == "end":
                    # Fin de l'appel
                    await websocket.send_json({
                        "type": "end",
                        "message": "Call ended"
                    })
                    break

                # Encoder l'audio en base64 pour le transport JSON
                audio_b64 = base64.b64encode(packet["data"]).decode('utf-8')
                await websocket.send_json({
                    "type": "audio",
                    "channel": packet["channel"],
                    "data": audio_b64,
                    "timestamp": packet["timestamp"],
                })

            except asyncio.TimeoutError:
                # Envoyer un ping pour maintenir la connexion
                await websocket.send_json({"type": "ping"})

    except WebSocketDisconnect:
        logger.info("WebSocket client disconnected from call %s audio stream", call_id)
    except Exception as e:
        logger.error("Error in audio stream WebSocket for call %s: %s", call_id, e, exc_info=True)
        try:
            await websocket.send_json({
                "type": "error",
                "message": str(e)
            })
        except:
            pass
    finally:
        # Désenregistrer le listener
        if queue:
            await audio_stream_mgr.unregister_listener(call_id, queue)
        try:
            await websocket.close()
        except:
            pass


@router.websocket("/api/outbound/events")
async def outbound_call_events_websocket(websocket: WebSocket):
    """WebSocket pour recevoir les événements d'appels sortants en temps réel."""
    from ..telephony.outbound_events_manager import get_outbound_events_manager

    events_mgr = get_outbound_events_manager()

    await websocket.accept()
    logger.info("WebSocket connection established for outbound call events")

    queue = await events_mgr.register_listener()

    try:
        while True:
            # Attendre un événement dans la queue
            try:
                event_json = await asyncio.wait_for(queue.get(), timeout=30.0)
                await websocket.send_text(event_json)
            except asyncio.TimeoutError:
                # Envoyer un ping pour maintenir la connexion
                await websocket.send_text(json.dumps({"type": "ping"}))
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected for outbound call events")
    except Exception as e:
        logger.error("Error in outbound call events WebSocket: %s", e, exc_info=True)
    finally:
        await events_mgr.unregister_listener(queue)
