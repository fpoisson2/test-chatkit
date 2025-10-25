from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from ..database import get_session
from ..dependencies import require_admin
from ..models import User
from ..schemas import (
    TelephonyTrunkSettingsResponse,
    TelephonyTrunkSettingsUpdateRequest,
)
from ..telephony_trunk_settings import (
    get_or_create_trunk_settings,
    update_trunk_settings,
)

router = APIRouter()


@router.get(
    "/api/admin/telephony-trunk",
    response_model=TelephonyTrunkSettingsResponse,
)
async def get_telephony_trunk_settings(
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> TelephonyTrunkSettingsResponse:
    settings = get_or_create_trunk_settings(session)
    return TelephonyTrunkSettingsResponse.model_validate(settings)


@router.patch(
    "/api/admin/telephony-trunk",
    response_model=TelephonyTrunkSettingsResponse,
)
async def update_telephony_trunk_settings(
    payload: TelephonyTrunkSettingsUpdateRequest,
    session: Session = Depends(get_session),
    _: User = Depends(require_admin),
) -> TelephonyTrunkSettingsResponse:
    updates: dict[str, object] = {}

    if "sip_bind_host" in payload.model_fields_set:
        host = (payload.sip_bind_host or "").strip()
        updates["sip_bind_host"] = host or None

    if "sip_bind_port" in payload.model_fields_set:
        port = payload.sip_bind_port
        if port is not None and not (0 < port < 65536):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Le port SIP doit être compris entre 1 et 65535.",
            )
        updates["sip_bind_port"] = port

    if "sip_username" in payload.model_fields_set:
        username = (payload.sip_username or "").strip()
        updates["sip_username"] = username or None

    if "sip_password" in payload.model_fields_set:
        password = (payload.sip_password or "").strip()
        updates["sip_password"] = password or None

    if not updates:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Aucun paramètre à mettre à jour.",
        )

    settings = update_trunk_settings(session, **updates)
    return TelephonyTrunkSettingsResponse.model_validate(settings)
