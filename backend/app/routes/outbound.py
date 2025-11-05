"""Routes API pour les appels sortants."""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import OutboundCall, SipAccount, User, WorkflowDefinition
from ..telephony.outbound_call_manager import get_outbound_call_manager

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
