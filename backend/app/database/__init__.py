from __future__ import annotations

import contextvars
import logging
import os
import threading
import time
from collections.abc import Iterator

from sqlalchemy import create_engine, event, text
import structlog
from sqlalchemy.engine import Engine
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session, sessionmaker

from ..config import get_settings

logger = logging.getLogger("chatkit.server")
settings = get_settings()
db_logger = structlog.get_logger("chatkit.db")
_request_id = contextvars.ContextVar("db_request_id", default=None)
_request_stats: dict[str, dict[str, float]] = {}
_request_stats_lock = threading.Lock()


def _get_engine_kwargs() -> dict:
    """Configure SQLAlchemy engine based on database type.

    For Supabase pooler (transaction mode), we need different settings:
    - No connection pooling on our side (Supabase handles it)
    - Prepared statements must be disabled for pgbouncer compatibility
    """
    base_kwargs = {
        "future": True,
        "pool_pre_ping": True,
    }

    # Detect Supabase pooler by URL pattern
    db_url = settings.database_url
    is_supabase_pooler = (
        "pooler.supabase.co" in db_url
        or "pooler.supabase.com" in db_url
        or os.getenv("DATABASE_USE_SUPABASE_POOLER", "").lower() in ("true", "1", "yes")
    )

    if is_supabase_pooler:
        # Supabase Session Pooler (port 5432) supports local connection pooling
        # Only Transaction Pooler (port 6543) requires NullPool
        is_transaction_pooler = ":6543" in db_url

        if is_transaction_pooler:
            from sqlalchemy.pool import NullPool
            base_kwargs.update(
                {
                    "poolclass": NullPool,
                    "connect_args": {"prepare_threshold": None},
                }
            )
            logger.info("Database configured for Supabase Transaction Pooler (NullPool)")
        else:
            # Session Pooler - use local pooling for better performance
            base_kwargs.update(
                {
                    "pool_size": 5,
                    "max_overflow": 10,
                    "pool_timeout": 30,
                    "pool_pre_ping": True,
                    "connect_args": {"prepare_threshold": None},
                }
            )
            logger.info("Database configured for Supabase Session Pooler (local pool)")
    else:
        # Standard PostgreSQL with local pooling
        base_kwargs.update(
            {
                "pool_size": 20,
                "max_overflow": 30,
                "pool_timeout": 60,
            }
        )
        logger.info("Database configured with local connection pooling")

    return base_kwargs


engine: Engine = create_engine(settings.database_url, **_get_engine_kwargs())

_slow_query_threshold_ms = float(os.getenv("DB_SLOW_QUERY_MS", "200"))
_log_queries = os.getenv("DB_LOG_QUERIES", "").lower() in ("1", "true", "yes")


def _trim_statement(statement: str, max_len: int = 500) -> str:
    if len(statement) <= max_len:
        return statement
    return statement[:max_len] + "…"


def set_request_id(value: str | None) -> None:
    _request_id.set(value)


def get_request_id() -> str | None:
    return _request_id.get()


def reset_request_stats(request_id: str) -> None:
    with _request_stats_lock:
        _request_stats[request_id] = {"count": 0.0, "total_ms": 0.0, "max_ms": 0.0}


def update_request_stats(duration_ms: float) -> None:
    request_id = _request_id.get()
    if not request_id:
        return
    with _request_stats_lock:
        stats = _request_stats.get(
            request_id, {"count": 0.0, "total_ms": 0.0, "max_ms": 0.0}
        )
        stats["count"] += 1.0
        stats["total_ms"] += duration_ms
        if duration_ms > stats["max_ms"]:
            stats["max_ms"] = duration_ms
        _request_stats[request_id] = stats


def get_request_stats(request_id: str) -> dict[str, float]:
    with _request_stats_lock:
        stats = _request_stats.get(request_id, {})
        return dict(stats)


def clear_request_stats(request_id: str) -> None:
    with _request_stats_lock:
        _request_stats.pop(request_id, None)


@event.listens_for(engine, "before_cursor_execute")
def _before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    conn.info.setdefault("query_start_time", []).append(time.perf_counter())


@event.listens_for(engine, "after_cursor_execute")
def _after_cursor_execute(conn, cursor, statement, parameters, context, executemany):
    start_list = conn.info.get("query_start_time")
    if not start_list:
        return
    start = start_list.pop()
    duration_ms = (time.perf_counter() - start) * 1000.0
    if _log_queries or duration_ms >= _slow_query_threshold_ms:
        db_logger.info(
            "db_query",
            duration_ms=round(duration_ms, 2),
            statement=_trim_statement(statement),
        )
    update_request_stats(duration_ms)
SessionLocal = sessionmaker(
    bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
)


def get_session(request=None) -> Iterator[Session]:
    """Provide a transactional database session with proper cleanup.

    Ensures transactions are committed or rolled back, and connections
    are properly returned to the pool to prevent connection leaks.
    """
    if request is not None and hasattr(request, "state"):
        request_id = getattr(request.state, "request_id", None)
        if request_id:
            set_request_id(request_id)
    session = SessionLocal()
    try:
        yield session
        session.commit()  # Commit if no exception occurred
    except Exception:
        session.rollback()  # Rollback on exception
        raise
    finally:
        session.close()  # Always close the session and return connection to pool
        set_request_id(None)


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
