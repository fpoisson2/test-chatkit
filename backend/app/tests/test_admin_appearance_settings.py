import os
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")

from backend.app.admin_settings import (  # noqa: E402
    DEFAULT_APPEARANCE_RADIUS_STYLE,
    serialize_appearance_settings,
    update_appearance_settings,
)
from backend.app.models import Base  # noqa: E402


@pytest.fixture()
def session_factory() -> sessionmaker[Session]:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    try:
        yield factory
    finally:
        engine.dispose()


def test_update_appearance_settings_radius_persists(
    session_factory: sessionmaker[Session],
) -> None:
    with session_factory() as session:
        settings = update_appearance_settings(session, radius_style="pill")

        assert settings.appearance_radius_style == "pill"

        serialized = serialize_appearance_settings(settings)
        assert serialized["radius_style"] == "pill"

        reset = update_appearance_settings(
            session, radius_style=DEFAULT_APPEARANCE_RADIUS_STYLE
        )
        assert reset.appearance_radius_style is None

        serialized_default = serialize_appearance_settings(reset)
        assert serialized_default["radius_style"] == DEFAULT_APPEARANCE_RADIUS_STYLE
