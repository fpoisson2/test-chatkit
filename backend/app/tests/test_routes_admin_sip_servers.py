from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

import pytest
from fastapi import HTTPException, status
from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./test-routes-admin-sip-servers.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app.models import Base, SipServer  # noqa: E402
from backend.app.routes import admin  # noqa: E402
from backend.app.schemas import (  # noqa: E402
    SipServerCreateRequest,
    SipServerUpdateRequest,
)


class _AdminUser:
    is_admin = True


@pytest.fixture()
def session_factory() -> sessionmaker[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)
    yield SessionFactory
    engine.dispose()


async def _create_server(
    session: Session,
    *,
    server_id: str = "primary",
    label: str = "Primary PBX",
) -> None:
    payload = SipServerCreateRequest(
        id=server_id,
        label=label,
        trunk_uri="sip:alice@example.com",
        username="alice",
        password="secret",
        contact_host="pbx.local",
        contact_port=5070,
        contact_transport="udp",
    )
    await admin.create_sip_server(payload, session=session, _=_AdminUser())


def test_create_and_list_sip_servers(session_factory: sessionmaker[Session]) -> None:
    async def _run() -> None:
        with session_factory() as session:
            payload = SipServerCreateRequest(
                id="primary",
                label="  Primary PBX  ",
                trunk_uri=" sip:alice@example.com ",
                username=" alice ",
                password=" secret ",
                contact_host=" gateway.local ",
                contact_port=5060,
                contact_transport=" UDP ",
            )

            created = await admin.create_sip_server(
                payload, session=session, _=_AdminUser()
            )

            assert created.id == "primary"
            assert created.label == "Primary PBX"
            assert created.trunk_uri == "sip:alice@example.com"
            assert created.username == "alice"
            assert created.contact_host == "gateway.local"
            assert created.contact_port == 5060
            assert created.contact_transport == "udp"
            assert created.has_password is True

            servers = await admin.list_sip_servers(session=session, _=_AdminUser())
            assert len(servers) == 1
            assert servers[0].id == "primary"

    asyncio.run(_run())


def test_update_sip_server_applies_partial_payload(
    session_factory: sessionmaker[Session],
) -> None:
    async def _run() -> None:
        with session_factory() as session:
            await _create_server(session)

            payload = SipServerUpdateRequest(
                label="  Europe PBX  ",
                username=None,
                password="  new-secret  ",
                contact_host="  eu.gateway.local  ",
                contact_port=5080,
                contact_transport=" TLS ",
            )

            updated = await admin.update_sip_server(
                "primary", payload, session=session, _=_AdminUser()
            )

            assert updated.label == "Europe PBX"
            assert updated.username is None
            assert updated.contact_host == "eu.gateway.local"
            assert updated.contact_port == 5080
            assert updated.contact_transport == "tls"
            assert updated.has_password is True

            stored = session.scalar(select(SipServer).where(SipServer.id == "primary"))
            assert stored is not None
            assert stored.label == "Europe PBX"
            assert stored.username is None
            assert stored.contact_transport == "tls"

    asyncio.run(_run())


def test_update_sip_server_rejects_unknown_id(
    session_factory: sessionmaker[Session],
) -> None:
    async def _run() -> None:
        with session_factory() as session:
            payload = SipServerUpdateRequest(label="Missing")
            with pytest.raises(HTTPException) as excinfo:
                await admin.update_sip_server(
                    "missing", payload, session=session, _=_AdminUser()
                )

        assert excinfo.value.status_code == status.HTTP_404_NOT_FOUND

    asyncio.run(_run())


def test_delete_sip_server_removes_entry(session_factory: sessionmaker[Session]) -> None:
    async def _run() -> None:
        with session_factory() as session:
            await _create_server(session)

            response = await admin.delete_sip_server(
                "primary", session=session, _=_AdminUser()
            )

            assert response.status_code == status.HTTP_204_NO_CONTENT
            removed = session.scalar(select(SipServer).where(SipServer.id == "primary"))
            assert removed is None

    asyncio.run(_run())
