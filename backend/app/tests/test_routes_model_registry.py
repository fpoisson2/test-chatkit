import asyncio
import datetime
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

os.environ.setdefault("DATABASE_URL", "sqlite:///./test-routes-model-registry.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app.models import AvailableModel, Base  # noqa: E402
from backend.app.routes import model_registry  # noqa: E402
from backend.app.schemas import AvailableModelUpdateRequest  # noqa: E402


class _StubUser:
    is_admin = True


@pytest.fixture()
def session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    SessionFactory = sessionmaker(bind=engine, expire_on_commit=False)
    yield SessionFactory
    engine.dispose()


def _create_model(
    session: Session,
    *,
    name: str,
    provider_slug: str | None = "litellm",
    provider_id: str | None = "primary",
) -> AvailableModel:
    now = datetime.datetime(2024, 1, 1, tzinfo=datetime.UTC)
    model = AvailableModel(
        name=name,
        display_name=f"Display {name}",
        description="Test",
        provider_id=provider_id,
        provider_slug=provider_slug,
        supports_reasoning=False,
        supports_previous_response_id=True,
        supports_reasoning_summary=True,
        created_at=now,
        updated_at=now,
    )
    session.add(model)
    session.commit()
    session.refresh(model)
    return model


def test_update_model_persists_changes(session_factory: sessionmaker[Session]) -> None:
    async def _run() -> None:
        with session_factory() as session:
            model = _create_model(session, name="gpt-4o-mini")

            payload = AvailableModelUpdateRequest(
                name="gpt-4o-mini-2024",
                display_name=" GPT-4o Mini 2024 ",
                description=None,
                supports_reasoning=True,
                supports_previous_response_id=False,
                supports_reasoning_summary=False,
                provider_id="primary-eu",
                provider_slug="LiteLLM",
            )

            result = await model_registry.update_model(
                model.id, payload, session=session, _=_StubUser()
            )

            assert result.name == "gpt-4o-mini-2024"
            assert result.display_name == "GPT-4o Mini 2024"
            assert result.description is None
            assert result.supports_reasoning is True
            assert result.supports_previous_response_id is False
            assert result.supports_reasoning_summary is False
            assert result.provider_id == "primary-eu"
            assert result.provider_slug == "litellm"

            stored = session.scalar(
                select(AvailableModel).where(AvailableModel.id == model.id)
            )
            assert stored is not None
            assert stored.name == "gpt-4o-mini-2024"
            assert stored.display_name == "GPT-4o Mini 2024"
            assert stored.provider_slug == "litellm"
            assert stored.supports_previous_response_id is False

    asyncio.run(_run())


def test_update_model_rejects_missing_provider_slug(
    session_factory: sessionmaker[Session],
) -> None:
    async def _run() -> None:
        with session_factory() as session:
            model = _create_model(session, name="gpt-4o-mini")

            payload = AvailableModelUpdateRequest(
                provider_id="alt-provider",
                provider_slug=None,
            )

            with pytest.raises(HTTPException) as excinfo:
                await model_registry.update_model(
                    model.id, payload, session=session, _=_StubUser()
                )

        assert excinfo.value.status_code == status.HTTP_400_BAD_REQUEST

    asyncio.run(_run())


def test_update_model_rejects_duplicate_name(
    session_factory: sessionmaker[Session],
) -> None:
    async def _run() -> None:
        with session_factory() as session:
            first = _create_model(session, name="gpt-4o-mini")
            second = _create_model(
                session,
                name="claude-3",
                provider_slug="anthropic",
                provider_id="anthropic-proxy",
            )

            payload = AvailableModelUpdateRequest(name=first.name)

            with pytest.raises(HTTPException) as excinfo:
                await model_registry.update_model(
                    second.id, payload, session=session, _=_StubUser()
                )

        assert excinfo.value.status_code == status.HTTP_400_BAD_REQUEST

    asyncio.run(_run())

