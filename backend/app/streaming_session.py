"""Streaming session management for resumable SSE connections.

This module provides functionality to:
- Track active streaming sessions
- Persist streaming events for replay
- Enable resume/reconnect after page refresh
"""

from __future__ import annotations

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import delete, select, update
from sqlalchemy.orm import Session

from .database import SessionLocal
from .models import StreamingEvent, StreamingSession

logger = logging.getLogger("chatkit.streaming_session")


class StreamingSessionManager:
    """Manages streaming sessions and event persistence for resume capability."""

    def __init__(self) -> None:
        self._event_counters: dict[str, int] = {}
        self._event_buffers: dict[str, list[tuple[str, str, dict[str, Any]]]] = {}
        self._buffer_locks: dict[str, asyncio.Lock] = {}
        self._flush_tasks: dict[str, asyncio.Task[None]] = {}

    def _get_lock(self, session_id: str) -> asyncio.Lock:
        """Get or create a lock for a session."""
        if session_id not in self._buffer_locks:
            self._buffer_locks[session_id] = asyncio.Lock()
        return self._buffer_locks[session_id]

    async def create_session(
        self, thread_id: str, owner_id: str
    ) -> StreamingSession:
        """Create a new streaming session for a thread."""
        session_id = f"ss_{uuid.uuid4().hex[:16]}"
        now = datetime.now(timezone.utc)

        def _create(db: Session) -> StreamingSession:
            session = StreamingSession(
                id=session_id,
                thread_id=thread_id,
                owner_id=owner_id,
                status="active",
                created_at=now,
                updated_at=now,
            )
            db.add(session)
            db.commit()
            db.refresh(session)
            return session

        result = await asyncio.to_thread(self._run_sync, _create)
        self._event_counters[session_id] = 0
        self._event_buffers[session_id] = []
        logger.debug(
            "Created streaming session %s for thread %s", session_id, thread_id
        )
        return result

    async def get_session(
        self, session_id: str, owner_id: str | None = None
    ) -> StreamingSession | None:
        """Get a streaming session by ID, optionally verifying ownership."""

        def _get(db: Session) -> StreamingSession | None:
            stmt = select(StreamingSession).where(StreamingSession.id == session_id)
            if owner_id is not None:
                stmt = stmt.where(StreamingSession.owner_id == owner_id)
            return db.execute(stmt).scalar_one_or_none()

        return await asyncio.to_thread(self._run_sync, _get)

    async def get_session_status(
        self, session_id: str, owner_id: str
    ) -> dict[str, Any] | None:
        """Get session status and metadata for resume logic."""
        session = await self.get_session(session_id, owner_id)
        if not session:
            return None

        return {
            "session_id": session.id,
            "thread_id": session.thread_id,
            "status": session.status,
            "last_event_id": session.last_event_id,
            "created_at": session.created_at.isoformat(),
            "updated_at": session.updated_at.isoformat(),
            "completed_at": (
                session.completed_at.isoformat() if session.completed_at else None
            ),
            "error_message": session.error_message,
        }

    async def persist_event(
        self, session_id: str, event_type: str, event_data: dict[str, Any]
    ) -> str:
        """Persist an event and return its ID.

        Events are buffered and flushed in batches for performance.
        """
        event_id = f"ev_{uuid.uuid4().hex[:16]}"

        # Increment sequence counter
        if session_id not in self._event_counters:
            self._event_counters[session_id] = 0
        self._event_counters[session_id] += 1
        sequence = self._event_counters[session_id]

        # Add event_id to data for client tracking
        event_data_with_id = {**event_data, "event_id": event_id}

        # Add to buffer
        lock = self._get_lock(session_id)
        async with lock:
            if session_id not in self._event_buffers:
                self._event_buffers[session_id] = []

            self._event_buffers[session_id].append(
                (event_id, event_type, event_data_with_id, sequence)
            )

            # Flush if buffer is large enough
            if len(self._event_buffers[session_id]) >= 10:
                await self._flush_buffer(session_id)
            else:
                # Schedule delayed flush if not already scheduled
                self._schedule_flush(session_id)

        return event_id

    def _schedule_flush(self, session_id: str) -> None:
        """Schedule a delayed flush for the buffer."""
        if session_id in self._flush_tasks:
            task = self._flush_tasks[session_id]
            if not task.done():
                return  # Already scheduled

        async def delayed_flush() -> None:
            await asyncio.sleep(0.1)  # 100ms delay
            lock = self._get_lock(session_id)
            async with lock:
                await self._flush_buffer(session_id)

        self._flush_tasks[session_id] = asyncio.create_task(delayed_flush())

    async def _flush_buffer(self, session_id: str) -> None:
        """Flush buffered events to database."""
        buffer = self._event_buffers.get(session_id, [])
        if not buffer:
            return

        self._event_buffers[session_id] = []
        now = datetime.now(timezone.utc)
        last_event_id = buffer[-1][0]

        def _flush(db: Session) -> None:
            for event_id, event_type, event_data, sequence in buffer:
                event = StreamingEvent(
                    id=event_id,
                    session_id=session_id,
                    sequence_number=sequence,
                    event_type=event_type,
                    event_data=event_data,
                    created_at=now,
                )
                db.add(event)

            # Update session's last_event_id and updated_at
            db.execute(
                update(StreamingSession)
                .where(StreamingSession.id == session_id)
                .values(last_event_id=last_event_id, updated_at=now)
            )
            db.commit()

        await asyncio.to_thread(self._run_sync, _flush)
        logger.debug(
            "Flushed %d events for session %s, last_event_id=%s",
            len(buffer),
            session_id,
            last_event_id,
        )

    async def get_events_after(
        self,
        session_id: str,
        after_event_id: str | None,
        owner_id: str,
    ) -> list[dict[str, Any]]:
        """Get all events after a given event ID for replay."""

        def _get(db: Session) -> list[dict[str, Any]]:
            # Verify ownership
            session_stmt = select(StreamingSession).where(
                StreamingSession.id == session_id,
                StreamingSession.owner_id == owner_id,
            )
            session = db.execute(session_stmt).scalar_one_or_none()
            if not session:
                return []

            # Get sequence number of after_event_id
            after_seq = 0
            if after_event_id:
                after_stmt = select(StreamingEvent.sequence_number).where(
                    StreamingEvent.id == after_event_id
                )
                result = db.execute(after_stmt).scalar_one_or_none()
                if result is not None:
                    after_seq = result

            # Get events after that sequence
            events_stmt = (
                select(StreamingEvent)
                .where(
                    StreamingEvent.session_id == session_id,
                    StreamingEvent.sequence_number > after_seq,
                )
                .order_by(StreamingEvent.sequence_number)
            )
            events = db.execute(events_stmt).scalars().all()

            return [
                {
                    "event_id": e.id,
                    "sequence": e.sequence_number,
                    "type": e.event_type,
                    "data": e.event_data,
                }
                for e in events
            ]

        return await asyncio.to_thread(self._run_sync, _get)

    async def complete_session(
        self, session_id: str, error: str | None = None
    ) -> None:
        """Mark session as completed or errored."""
        # First flush any remaining events
        lock = self._get_lock(session_id)
        async with lock:
            await self._flush_buffer(session_id)

        now = datetime.now(timezone.utc)
        status = "error" if error else "completed"

        def _complete(db: Session) -> None:
            db.execute(
                update(StreamingSession)
                .where(StreamingSession.id == session_id)
                .values(
                    status=status,
                    completed_at=now,
                    updated_at=now,
                    error_message=error,
                )
            )
            db.commit()

        await asyncio.to_thread(self._run_sync, _complete)

        # Clean up in-memory state
        self._event_counters.pop(session_id, None)
        self._event_buffers.pop(session_id, None)
        self._buffer_locks.pop(session_id, None)
        if session_id in self._flush_tasks:
            task = self._flush_tasks.pop(session_id)
            if not task.done():
                task.cancel()

        logger.debug(
            "Completed streaming session %s with status=%s", session_id, status
        )

    async def cleanup_old_sessions(
        self, max_age_hours: int = 24, stuck_timeout_hours: int = 1
    ) -> dict[str, int]:
        """Clean up old streaming sessions.

        Args:
            max_age_hours: Delete completed/error sessions older than this
            stuck_timeout_hours: Delete active sessions older than this (stuck)

        Returns:
            Dict with counts of deleted sessions
        """
        now = datetime.now(timezone.utc)
        from datetime import timedelta

        completed_cutoff = now - timedelta(hours=max_age_hours)
        stuck_cutoff = now - timedelta(hours=stuck_timeout_hours)

        def _cleanup(db: Session) -> dict[str, int]:
            # Delete old completed/errored sessions (cascades to events)
            completed_result = db.execute(
                delete(StreamingSession).where(
                    StreamingSession.status.in_(["completed", "error"]),
                    StreamingSession.updated_at < completed_cutoff,
                )
            )

            # Delete sessions stuck in 'active' for too long
            stuck_result = db.execute(
                delete(StreamingSession).where(
                    StreamingSession.status == "active",
                    StreamingSession.updated_at < stuck_cutoff,
                )
            )

            db.commit()

            return {
                "deleted_completed": completed_result.rowcount,
                "deleted_stuck": stuck_result.rowcount,
            }

        result = await asyncio.to_thread(self._run_sync, _cleanup)
        logger.info(
            "Cleaned up streaming sessions: %d completed, %d stuck",
            result["deleted_completed"],
            result["deleted_stuck"],
        )
        return result

    def _run_sync(self, func: Any) -> Any:
        """Run a synchronous function with a database session."""
        with SessionLocal() as session:
            return func(session)


# Global instance
_streaming_session_manager: StreamingSessionManager | None = None


def get_streaming_session_manager() -> StreamingSessionManager:
    """Get the global StreamingSessionManager instance."""
    global _streaming_session_manager
    if _streaming_session_manager is None:
        _streaming_session_manager = StreamingSessionManager()
    return _streaming_session_manager
