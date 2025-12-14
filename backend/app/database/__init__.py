from __future__ import annotations

import logging
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings

logger = logging.getLogger("chatkit.server")
settings = get_settings()

engine: Engine = create_engine(
    settings.database_url,
    future=True,
    pool_pre_ping=True,
    pool_size=20,
    max_overflow=30,
    pool_timeout=60,
)
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
)


def get_session() -> Iterator[Session]:
    """Provide a transactional database session with proper cleanup.

    Ensures transactions are committed or rolled back, and connections
    are properly returned to the pool to prevent connection leaks.
    """
    session = SessionLocal()
    try:
        yield session
        session.commit()  # Commit if no exception occurred
    except Exception:
        session.rollback()  # Rollback on exception
        raise
    finally:
        session.close()  # Always close the session and return connection to pool


def wait_for_database() -> None:
    retries = settings.database_connect_retries
    delay = settings.database_connect_delay
    for attempt in range(1, retries + 1):
        try:
            with engine.connect() as connection:
                connection.execute(text("SELECT 1"))
            return
        except OperationalError as exc:
            logger.warning(
                "Database connection failed (attempt %s/%s): %s",
                attempt,
                retries,
                exc,
            )
            time.sleep(delay)
    raise RuntimeError("Database connection failed after retries")


def ensure_database_extensions() -> None:
    if engine.dialect.name != "postgresql":
        return
    with engine.begin() as connection:
        connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))


def ensure_vector_indexes() -> None:
    if engine.dialect.name != "postgresql":
        return
    statements = (
        "CREATE INDEX IF NOT EXISTS ix_json_chunks_embedding "
        "ON json_chunks USING ivfflat (embedding vector_cosine_ops)",
        "CREATE INDEX IF NOT EXISTS ix_json_chunks_text_search "
        "ON json_chunks USING gin "
        "(to_tsvector('simple', coalesce(linearized_text, '')))",
    )
    with engine.begin() as connection:
        for statement in statements:
            connection.execute(text(statement))
