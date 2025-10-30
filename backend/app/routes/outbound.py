"""Routes API pour les appels sortants."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from ..auth import require_admin_user
from ..database import get_db
from ..models import OutboundCall, SipAccount, WorkflowDefinition
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
    db: Session = Depends(get_db),
    _: Any = Depends(require_admin_user),
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
    db: Session = Depends(get_db),
    _: Any = Depends(require_admin_user),
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
    db: Session = Depends(get_db),
    _: Any = Depends(require_admin_user),
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
