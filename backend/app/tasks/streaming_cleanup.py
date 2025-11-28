"""
Celery tasks for streaming session cleanup.
"""
from __future__ import annotations

import asyncio
import logging

from ..celery_app import celery_app

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.streaming_cleanup.cleanup_streaming_sessions")
def cleanup_streaming_sessions(
    self,
    max_age_hours: int = 24,
    stuck_timeout_hours: int = 1,
):
    """
    Celery task to clean up old streaming sessions.

    This task:
    1. Deletes completed/errored sessions older than max_age_hours
    2. Deletes active sessions stuck for longer than stuck_timeout_hours

    Args:
        self: Celery task instance (bind=True)
        max_age_hours: Delete completed sessions older than this (default: 24)
        stuck_timeout_hours: Delete stuck active sessions older than this (default: 1)

    Returns:
        Dict with counts of deleted sessions
    """
    from ..streaming_session import get_streaming_session_manager

    try:
        manager = get_streaming_session_manager()
        result = asyncio.run(
            manager.cleanup_old_sessions(
                max_age_hours=max_age_hours,
                stuck_timeout_hours=stuck_timeout_hours,
            )
        )

        logger.info(
            "Streaming session cleanup completed: %d completed, %d stuck deleted",
            result["deleted_completed"],
            result["deleted_stuck"],
        )

        return {
            "status": "success",
            "deleted_completed": result["deleted_completed"],
            "deleted_stuck": result["deleted_stuck"],
        }

    except Exception as e:
        logger.exception("Streaming session cleanup failed: %s", e)
        raise
