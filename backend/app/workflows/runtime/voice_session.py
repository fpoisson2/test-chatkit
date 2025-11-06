from __future__ import annotations

import json
import logging
from collections.abc import Awaitable, Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from chatkit.agents import AgentContext
from chatkit.types import (
    AssistantMessageContent,
    AssistantMessageItem,
    CustomTask,
    InferenceOptions,
    TaskItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadStreamEvent,
    UserMessageItem,
    UserMessageTextContent,
)

from ...chatkit_server.actions import _json_safe_copy
from ...chatkit_server.context import (
    _clone_conversation_history_snapshot,
    _set_wait_state_metadata,
)
from ...realtime_runner import close_voice_session, open_voice_session
from .vector_ingestion import ingest_vector_store_step

logger = logging.getLogger("chatkit.server")


@dataclass(frozen=True)
class VoiceSessionStartResult:
    voice_context: dict[str, Any]
    wait_state_payload: dict[str, Any]
    realtime_event: dict[str, Any]
    step_payload: dict[str, Any]
    last_step_context: dict[str, Any]


@dataclass(frozen=True)
class VoiceSessionResumeResult:
    processed: bool
    last_step_context: dict[str, Any] | None = None
    wait_reason: str | None = None


class VoiceSessionManager:
    """Service responsible for managing workflow voice sessions."""

    def __init__(
        self,
        *,
        open_session: Callable[..., Awaitable[Any]] = open_voice_session,
        close_session: Callable[..., Awaitable[Any]] = close_voice_session,
    ) -> None:
        self._open_session = open_session
        self._close_session = close_session

    async def start_voice_session(
        self,
        *,
        current_step_slug: str,
        title: str,
        voice_context: dict[str, Any],
        event_context: dict[str, Any],
        agent_context: AgentContext[Any],
        user_id: str,
        conversation_history: list[dict[str, Any]],
        state: dict[str, Any],
        thread: Any,
        current_input_item_id: str | None,
        next_step_slug: str | None,
        record_step: Callable[[str, str, Any], Awaitable[None]] | None,
        emit_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None,
    ) -> VoiceSessionStartResult:
        metadata_payload: dict[str, Any] = {
            "step_slug": current_step_slug,
        }
        if thread is not None and getattr(thread, "id", None):
            metadata_payload["thread_id"] = thread.id
        if title:
            metadata_payload["step_title"] = title

        realtime_config = event_context.get("realtime")
        if isinstance(realtime_config, Mapping):
            tool_permissions = realtime_config.get("tools")
            if isinstance(tool_permissions, Mapping):
                metadata_payload["tool_permissions"] = dict(tool_permissions)

        session_handle = await self._open_session(
            user_id=user_id,
            model=event_context["model"],
            voice=event_context.get("voice"),
            instructions=event_context["instructions"],
            provider_id=event_context.get("model_provider_id"),
            provider_slug=event_context.get("model_provider_slug"),
            realtime=event_context.get("realtime"),
            tools=event_context.get("tools"),
            handoffs=event_context.get("handoffs"),
            metadata=metadata_payload,
        )

        realtime_secret = session_handle.payload
        voice_context["session_id"] = session_handle.session_id
        voice_context["client_secret"] = realtime_secret
        event_context["session_id"] = session_handle.session_id

        realtime_event = {
            "type": "realtime.event",
            "step": {"slug": current_step_slug, "title": title},
            "event": {
                "type": "history",
                "session_id": session_handle.session_id,
                "session": event_context,
                "client_secret": realtime_secret,
                "tool_permissions": event_context["realtime"]["tools"],
            },
        }

        if emit_stream_event is not None and agent_context.thread is not None:
            task_item = TaskItem(
                id=agent_context.generate_id("task"),
                thread_id=agent_context.thread.id,
                created_at=datetime.now(),
                task=CustomTask(
                    title=title,
                    content=json.dumps(realtime_event, ensure_ascii=False),
                ),
            )
            await emit_stream_event(ThreadItemAddedEvent(item=task_item))
            await emit_stream_event(ThreadItemDoneEvent(item=task_item))

        step_payload = {
            "status": "waiting_for_voice",
            "voice_session": voice_context,
        }

        if record_step is not None:
            await record_step(current_step_slug, title, step_payload)

        last_step_context = {"voice_session": voice_context}
        state["voice_session_active"] = True
        state["last_voice_session"] = voice_context

        wait_state_payload: dict[str, Any] = {
            "slug": current_step_slug,
            "input_item_id": current_input_item_id,
            "type": "voice",
            "voice_event": realtime_event,
        }

        conversation_snapshot = _clone_conversation_history_snapshot(
            conversation_history
        )
        if conversation_snapshot:
            wait_state_payload["conversation_history"] = conversation_snapshot
        wait_state_payload["state"] = _json_safe_copy(state)
        if next_step_slug:
            wait_state_payload["next_step_slug"] = next_step_slug
        if thread is not None:
            _set_wait_state_metadata(thread, wait_state_payload)

        return VoiceSessionStartResult(
            voice_context=voice_context,
            wait_state_payload=wait_state_payload,
            realtime_event=realtime_event,
            step_payload=step_payload,
            last_step_context=last_step_context,
        )

    async def resume_from_wait_state(
        self,
        *,
        current_step_slug: str,
        title: str,
        voice_context: dict[str, Any],
        voice_wait_state: Mapping[str, Any],
        conversation_history: list[dict[str, Any]],
        state: dict[str, Any],
        agent_context: AgentContext[Any],
        record_step: Callable[[str, str, Any], Awaitable[None]] | None,
        emit_stream_event: Callable[[ThreadStreamEvent], Awaitable[None]] | None,
        ingest_step: Callable[..., Awaitable[Any]] | None,
        vector_config: Any,
        step_slug_for_ingestion: str,
        session_factory: Any,
        thread: Any,
        wait_reason: str,
        agent_key: str,
    ) -> VoiceSessionResumeResult:
        stored_session_context = voice_wait_state.get("voice_session")
        if isinstance(stored_session_context, Mapping):
            for key, value in stored_session_context.items():
                if key not in voice_context or not voice_context[key]:
                    voice_context[key] = value

        transcripts_payload = voice_wait_state.get("voice_transcripts")
        if not transcripts_payload:
            return VoiceSessionResumeResult(processed=False, wait_reason=wait_reason)

        status_info = voice_wait_state.get("voice_session_status")
        if isinstance(status_info, Mapping):
            voice_context["session_status"] = dict(status_info)

        normalized_transcripts: list[dict[str, Any]] = []
        voice_messages_created = voice_wait_state.get("voice_messages_created", False)

        is_sequence = isinstance(transcripts_payload, Sequence)
        is_textual = isinstance(transcripts_payload, str | bytes | bytearray)
        iterable = transcripts_payload if is_sequence and not is_textual else []

        for entry in iterable:
            if not isinstance(entry, Mapping):
                continue
            role_raw = entry.get("role")
            if not isinstance(role_raw, str):
                continue
            normalized_role = role_raw.strip().lower()
            if normalized_role not in {"user", "assistant"}:
                continue
            text_raw = entry.get("text")
            if not isinstance(text_raw, str):
                continue
            text_value = text_raw.strip()
            if not text_value:
                continue
            transcript_entry: dict[str, Any] = {
                "role": normalized_role,
                "text": text_value,
            }
            status_raw = entry.get("status")
            if isinstance(status_raw, str) and status_raw.strip():
                transcript_entry["status"] = status_raw.strip()
            normalized_transcripts.append(transcript_entry)

            if normalized_role == "user":
                conversation_history.append(
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "input_text",
                                "text": text_value,
                            }
                        ],
                    }
                )
                if (
                    not voice_messages_created
                    and emit_stream_event is not None
                    and agent_context.thread is not None
                ):
                    user_item = UserMessageItem(
                        id=agent_context.generate_id("message"),
                        thread_id=agent_context.thread.id,
                        created_at=datetime.now(),
                        content=[UserMessageTextContent(text=text_value)],
                        attachments=[],
                        quoted_text=None,
                        inference_options=InferenceOptions(),
                    )
                    await emit_stream_event(ThreadItemAddedEvent(item=user_item))
                    await emit_stream_event(ThreadItemDoneEvent(item=user_item))
            else:
                conversation_history.append(
                    {
                        "role": "assistant",
                        "content": [
                            {
                                "type": "output_text",
                                "text": text_value,
                            }
                        ],
                    }
                )
                if (
                    not voice_messages_created
                    and emit_stream_event is not None
                    and agent_context.thread is not None
                ):
                    assistant_item = AssistantMessageItem(
                        id=agent_context.generate_id("message"),
                        thread_id=agent_context.thread.id,
                        created_at=datetime.now(),
                        content=[AssistantMessageContent(text=text_value)],
                    )
                    await emit_stream_event(
                        ThreadItemAddedEvent(item=assistant_item)
                    )
                    await emit_stream_event(ThreadItemDoneEvent(item=assistant_item))

        if not normalized_transcripts:
            return VoiceSessionResumeResult(processed=False, wait_reason=wait_reason)

        step_output = {"transcripts": normalized_transcripts}
        output_text = "\n\n".join(
            f"{entry['role']}: {entry['text']}" for entry in normalized_transcripts
        )
        last_step_context = {
            "voice_transcripts": normalized_transcripts,
            "voice_session": voice_context,
            "output": step_output,
            "output_parsed": step_output,
            "output_structured": step_output,
            "output_text": output_text,
        }

        state["last_voice_session"] = voice_context
        state["last_voice_transcripts"] = normalized_transcripts
        state["last_agent_key"] = agent_key
        state["last_agent_output"] = step_output
        state["last_agent_output_text"] = output_text
        state["last_agent_output_structured"] = step_output
        state.pop("voice_session_active", None)

        session_identifier = voice_context.get("session_id")
        if not session_identifier:
            stored_session = voice_wait_state.get("voice_session")
            if isinstance(stored_session, Mapping):
                session_identifier = stored_session.get("session_id")
        if not session_identifier:
            stored_event = voice_wait_state.get("voice_event")
            if isinstance(stored_event, Mapping):
                event_payload = stored_event.get("event")
                if isinstance(event_payload, Mapping):
                    session_identifier = event_payload.get("session_id")

        if session_identifier:
            try:
                await self._close_session(session_id=str(session_identifier))
            except Exception as exc:  # pragma: no cover - best effort cleanup
                logger.debug(
                    "Impossible de fermer la session Realtime %s : %s",
                    voice_context.get("session_id"),
                    exc,
                )

        if record_step is not None:
            await record_step(current_step_slug, title, step_output)

        await ingest_vector_store_step(
            vector_config,
            step_slug=step_slug_for_ingestion,
            step_title=title,
            step_context=last_step_context,
            state=state,
            default_input_context=last_step_context,
            session_factory=session_factory,
            ingest_step=ingest_step,
        )

        if thread is not None:
            _set_wait_state_metadata(thread, None)

        return VoiceSessionResumeResult(
            processed=True,
            last_step_context=last_step_context,
        )

