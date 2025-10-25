from __future__ import annotations

import datetime
from typing import cast

from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import get_settings
from .models import TelephonyTrunkSettings

_UNSET = object()


def _now() -> datetime.datetime:
    return datetime.datetime.now(datetime.UTC)


def _normalize_optional_text(value: str | None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        return str(value) or None
    trimmed = value.strip()
    return trimmed or None


def get_or_create_trunk_settings(session: Session) -> TelephonyTrunkSettings:
    settings = session.scalar(select(TelephonyTrunkSettings).limit(1))
    if settings:
        return settings

    defaults = get_settings()
    settings = TelephonyTrunkSettings(
        sip_bind_host=defaults.sip_bind_host,
        sip_bind_port=defaults.sip_bind_port,
        sip_username=defaults.sip_username,
        sip_password=defaults.sip_password,
    )
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings


def update_trunk_settings(
    session: Session,
    *,
    sip_bind_host: str | None | object = _UNSET,
    sip_bind_port: int | None | object = _UNSET,
    sip_username: str | None | object = _UNSET,
    sip_password: str | None | object = _UNSET,
) -> TelephonyTrunkSettings:
    settings = get_or_create_trunk_settings(session)

    if sip_bind_host is not _UNSET:
        settings.sip_bind_host = _normalize_optional_text(
            cast(str | None, sip_bind_host)
        )
    if sip_bind_port is not _UNSET:
        settings.sip_bind_port = cast(int | None, sip_bind_port)
    if sip_username is not _UNSET:
        settings.sip_username = _normalize_optional_text(
            cast(str | None, sip_username)
        )
    if sip_password is not _UNSET:
        settings.sip_password = _normalize_optional_text(
            cast(str | None, sip_password)
        )

    settings.updated_at = _now()
    session.add(settings)
    session.commit()
    session.refresh(settings)
    return settings
