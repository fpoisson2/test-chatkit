from __future__ import annotations

import asyncio
import base64
import json
import logging
import uuid
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from agents.realtime.events import (
    RealtimeAgentEndEvent,
    RealtimeAgentStartEvent,
    RealtimeAudio,
    RealtimeAudioEnd,
    RealtimeAudioInterrupted,
    RealtimeError,
    RealtimeHandoffEvent,
    RealtimeHistoryAdded,
    RealtimeHistoryUpdated,
    RealtimeToolEnd,
    RealtimeToolStart,
)
from agents.realtime.items import (
    AssistantMessageItem as RealtimeAssistantMessageItem,
)
from agents.realtime.items import (
    UserMessageItem as RealtimeUserMessageItem,
)
from agents.realtime.model_inputs import RealtimeModelSendRawMessage
from agents.tool import Tool
from fastapi import WebSocket, WebSocketDisconnect
from openai.types.realtime.realtime_conversation_item_assistant_message import (
    Content as AssistantContent,
)
from openai.types.realtime.realtime_conversation_item_assistant_message import (
    RealtimeConversationItemAssistantMessage,
)
from openai.types.realtime.realtime_conversation_item_user_message import (
    Content as UserContent,
)
from openai.types.realtime.realtime_conversation_item_user_message import (
    RealtimeConversationItemUserMessage,
)

from chatkit.types import (
    AssistantMessageContent,
    InferenceOptions,
    ThreadMetadata,
    UserMessageTextContent,
)
from chatkit.types import (
    AssistantMessageItem as ChatKitAssistantMessageItem,
)
from chatkit.types import (
    ThreadItem as ChatKitThreadItem,
)
from chatkit.types import (
    UserMessageItem as ChatKitUserMessageItem,
)

from .chatkit import get_chatkit_server
from .chatkit_server.context import (
    ChatKitRequestContext,
    _get_wait_state_metadata,
    _set_wait_state_metadata,
)
from .config import get_settings
from .realtime_runner import VoiceSessionHandle, get_voice_session_handle
from .request_context import build_chatkit_request_context
from .voice_workflow import finalize_voice_wait_state

logger = logging.getLogger("chatkit.realtime.gateway")


def _json_safe(value: Any) -> Any:
    """Convertir récursivement en structure JSON sérialisable."""
    if value is None or isinstance(value, str | int | float | bool):
        return value
    if isinstance(value, Mapping):
        return {str(key): _json_safe(val) for key, val in value.items()}
    if isinstance(value, list | tuple | set):
        return [_json_safe(item) for item in value]
    model_dump = getattr(value, "model_dump", None)
    if callable(model_dump):
        try:
            return model_dump(mode="json")
        except TypeError:
            return model_dump()
    if isinstance(value, BaseException):
        return {
            "type": value.__class__.__name__,
            "message": str(value),
        }
    return str(value)


@dataclass(eq=False)
class GatewayUser:
    id: str
    email: str | None


@dataclass(eq=False)
class GatewayConnection:
    websocket: WebSocket
    user: GatewayUser
    authorization: str
    id: str = field(default_factory=lambda: uuid.uuid4().hex)
    send_lock: asyncio.Lock = field(default_factory=asyncio.Lock)

    def __hash__(self) -> int:  # pragma: no cover - requis pour les ensembles
        return hash(self.id)

    @property
    def user_id(self) -> str:
        return self.user.id

    async def send_json(self, payload: Mapping[str, Any]) -> None:
        message = json.dumps(payload, ensure_ascii=False)
        async with self.send_lock:
            await self.websocket.send_text(message)


class _RealtimeSessionState:
    """État interne d'une session Realtime suivie par la passerelle."""

    def __init__(
        self,
        handle: VoiceSessionHandle,
        gateway: RealtimeSessionGateway,
    ) -> None:
        self.handle = handle
        self.gateway = gateway
        self.history: list[dict[str, Any]] = []
        self.listeners: set[GatewayConnection] = set()
        self.owner_user_id = str(handle.metadata.get("user_id") or "")
        self._lock = asyncio.Lock()
        self._session = None
        self._session_task: asyncio.Task[None] | None = None
        self._closed = False
        self._send_lock = asyncio.Lock()
        self._input_audio_log_skip = 0
        self._chatkit_context: ChatKitRequestContext | None = None
        self._chatkit_server = None
        self._thread_metadata: ThreadMetadata | None = None
        self._chatkit_item_by_realtime: dict[str, str] = {}
        self._chatkit_item_created_at: dict[str, datetime] = {}
        self._voice_messages_marked = False
        self._history_primed = False

    async def ensure_session_started(self) -> None:
        if self._session is not None:
            return

        primed = False

        async with self._lock:
            if self._session is not None:
                return

            if not self.handle.client_secret:
                raise RuntimeError("Realtime client secret is missing for the session")

            model_settings: dict[str, Any] = {}
            model_name = self.handle.metadata.get("model")
            if isinstance(model_name, str) and model_name:
                model_settings["model_name"] = model_name

            voice_value = self.handle.metadata.get("voice")
            if isinstance(voice_value, str) and voice_value:
                model_settings["voice"] = voice_value

            realtime_config = self.handle.metadata.get("realtime")
            if isinstance(realtime_config, Mapping):
                for key in (
                    "turn_detection",
                    "modalities",
                    "input_audio_format",
                    "output_audio_format",
                    "speed",
                ):
                    value = realtime_config.get(key)
                    if value is not None:
                        model_settings[key] = value

            tools_config = self.handle.metadata.get("sdk_tools")
            filtered_tools: list[Tool] = []
            if isinstance(tools_config, list):
                filtered_tools = [
                    tool for tool in tools_config if isinstance(tool, Tool)
                ]
            if not filtered_tools:
                legacy_tools = self.handle.metadata.get("tools")
                if isinstance(legacy_tools, list):
                    filtered_tools = [
                        tool for tool in legacy_tools if isinstance(tool, Tool)
                    ]
            if filtered_tools:
                model_settings["tools"] = filtered_tools

            model_config: dict[str, Any] = {
                "api_key": self.handle.client_secret,
                "initial_model_settings": model_settings,
            }

            session = await self.handle.runner.run(model_config=model_config)
            await session.__aenter__()
            self._session = session
            self._session_task = asyncio.create_task(self._pump_events())
            primed = True

        if primed:
            try:
                await self._prime_session_history()
            except Exception:  # pragma: no cover - priming should not fail session
                logger.exception(
                    "Échec de l'initialisation de l'historique ChatKit (session=%s)",
                    self.handle.session_id,
                )

    async def _pump_events(self) -> None:
        assert self._session is not None
        session = self._session
        try:
            async for event in session:
                try:
                    await self._handle_event_side_effects(event)
                except Exception:  # pragma: no cover - robustesse best effort
                    logger.exception(
                        "Erreur lors de la persistance de l'évènement Realtime",
                        exc_info=True,
                    )
                payload = self._serialize_event(event)
                if payload is None:
                    continue
                await self.gateway.broadcast_session_event(self, payload)
        except Exception as exc:  # pragma: no cover - garde-fou transport
            logger.exception("Erreur dans le flux Realtime", exc_info=exc)
            await self.gateway.broadcast_session_event(
                self,
                {
                    "type": "session_error",
                    "error": str(exc),
                },
            )
        finally:
            await self.gateway.handle_session_stream_closed(self)

    async def shutdown(self) -> None:
        async with self._lock:
            if self._closed:
                return
            self._closed = True
            session = self._session
            task = self._session_task
            self._session = None
            self._session_task = None

        if task is not None:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:  # pragma: no cover - flux arrêté
                pass
            except Exception:  # pragma: no cover - loggée ailleurs
                pass

        if session is not None:
            try:
                await session.close()
            except Exception:  # pragma: no cover - nettoyage best effort
                logger.debug(
                    "Échec de la fermeture propre de la session Realtime",
                    exc_info=True,
                )

    async def add_listener(self, connection: GatewayConnection) -> None:
        async with self._lock:
            self.listeners.add(connection)
        await self.ensure_session_started()
        if self.history:
            await connection.send_json(
                {
                    "type": "history",
                    "session_id": self.handle.session_id,
                    "history": self.history,
                }
            )

    async def remove_listener(self, connection: GatewayConnection) -> None:
        async with self._lock:
            self.listeners.discard(connection)

    @property
    def thread_id(self) -> str | None:
        value = self.handle.metadata.get("thread_id")
        if isinstance(value, str):
            candidate = value.strip()
            if candidate:
                return candidate
        return None

    def session_payload(self) -> dict[str, Any]:
        session_info: dict[str, Any] = {
            "model": self.handle.metadata.get("model"),
            "voice": self.handle.metadata.get("voice"),
            "realtime": self.handle.metadata.get("realtime"),
        }
        instructions = getattr(self.handle.agent, "instructions", None)
        if isinstance(instructions, str):
            session_info["instructions"] = instructions
        tools = self.handle.metadata.get("tools")
        if tools is not None:
            session_info["tools"] = tools
        return session_info

    async def _ensure_chatkit_context(self) -> bool:
        if (
            self._chatkit_context is not None
            and self._chatkit_server is not None
            and self._thread_metadata is not None
        ):
            return True

        thread_id = self.thread_id
        owner_id = self.owner_user_id.strip()
        if not thread_id or not owner_id:
            return False

        try:
            server = get_chatkit_server()
        except Exception:
            logger.exception(
                "Impossible de récupérer le serveur ChatKit (session=%s)",
                self.handle.session_id,
            )
            return False

        context = ChatKitRequestContext(user_id=owner_id, email=None)
        try:
            thread = await server.store.load_thread(thread_id, context)
        except Exception:
            logger.exception(
                "Impossible de charger le thread %s pour la session %s",
                thread_id,
                self.handle.session_id,
            )
            return False

        self._chatkit_server = server
        self._chatkit_context = context
        self._thread_metadata = thread
        return True

    async def _prime_session_history(self) -> None:
        if self._history_primed or self._session is None:
            return

        if not await self._ensure_chatkit_context():
            self._history_primed = True
            return

        assert self._chatkit_server is not None
        assert self._chatkit_context is not None
        assert self._thread_metadata is not None

        thread_id = self._thread_metadata.id
        try:
            page = await self._chatkit_server.store.load_thread_items(
                thread_id,
                after=None,
                limit=1000,
                order="asc",
                context=self._chatkit_context,
            )
        except Exception:
            logger.exception(
                "Impossible de charger l'historique ChatKit (thread=%s)",
                thread_id,
            )
            self._history_primed = True
            return

        session = self._session
        for item in getattr(page, "data", []):
            conversation_item = self._convert_chatkit_item_to_conversation_item(item)
            if conversation_item is None:
                continue

            if conversation_item.id:
                chatkit_id = conversation_item.id
                self._chatkit_item_by_realtime[chatkit_id] = chatkit_id
                created_at = getattr(item, "created_at", None)
                if isinstance(created_at, datetime):
                    if created_at.tzinfo is None:
                        created_at = created_at.replace(tzinfo=timezone.utc)
                    self._chatkit_item_created_at[chatkit_id] = created_at
                else:
                    self._chatkit_item_created_at[chatkit_id] = datetime.now(
                        timezone.utc
                    )

            message = RealtimeModelSendRawMessage(
                message={
                    "type": "conversation.item.create",
                    "other_data": {
                        "item": conversation_item.model_dump(exclude_none=True)
                    },
                }
            )
            await session.model.send_event(message)

        self._history_primed = True

    def _convert_chatkit_item_to_conversation_item(
        self, item: ChatKitThreadItem
    ) -> (
        RealtimeConversationItemUserMessage
        | RealtimeConversationItemAssistantMessage
        | None
    ):
        if isinstance(item, ChatKitUserMessageItem):
            contents: list[UserContent] = []
            for content in item.content:
                if isinstance(content, UserMessageTextContent):
                    text = content.text.strip()
                    if text:
                        contents.append(UserContent(type="input_text", text=text))
            if not contents:
                return None
            return RealtimeConversationItemUserMessage(
                id=item.id,
                type="message",
                role="user",
                status="completed",
                content=contents,
            )

        if isinstance(item, ChatKitAssistantMessageItem):
            contents: list[AssistantContent] = []
            for content in item.content:
                text = getattr(content, "text", "")
                if isinstance(text, str):
                    text_value = text.strip()
                    if text_value:
                        contents.append(
                            AssistantContent(type="output_text", text=text_value)
                        )
            if not contents:
                return None
            return RealtimeConversationItemAssistantMessage(
                id=item.id,
                type="message",
                role="assistant",
                status="completed",
                content=contents,
            )

        return None

    async def _handle_event_side_effects(self, event: Any) -> None:
        if isinstance(event, RealtimeHistoryAdded):
            await self._upsert_chatkit_messages(
                [event.item],
                allow_create=True,
            )
        elif isinstance(event, RealtimeHistoryUpdated):
            await self._upsert_chatkit_messages(event.history, allow_create=False)

    async def _upsert_chatkit_messages(
        self,
        items: Iterable[RealtimeUserMessageItem | RealtimeAssistantMessageItem],
        *,
        allow_create: bool,
    ) -> None:
        if not await self._ensure_chatkit_context():
            return

        assert self._chatkit_server is not None
        assert self._chatkit_context is not None
        assert self._thread_metadata is not None

        store = self._chatkit_server.store
        thread_id = self._thread_metadata.id

        for item in items:
            role: str | None
            if isinstance(item, RealtimeUserMessageItem):
                role = "user"
            elif isinstance(item, RealtimeAssistantMessageItem):
                role = "assistant"
            else:
                continue

            realtime_id = getattr(item, "item_id", None) or getattr(item, "id", None)
            if not isinstance(realtime_id, str) or not realtime_id:
                continue

            text = self._extract_text_from_realtime_item(item)
            if not text:
                continue

            chatkit_id = self._chatkit_item_by_realtime.get(realtime_id)
            if chatkit_id is None:
                if not allow_create:
                    continue
                chatkit_id = store.generate_item_id(
                    "message",
                    self._thread_metadata,
                    self._chatkit_context,
                )
                created_at = datetime.now(timezone.utc)
                self._chatkit_item_by_realtime[realtime_id] = chatkit_id
                self._chatkit_item_created_at[realtime_id] = created_at
                message = self._build_chatkit_message(
                    role=role,
                    message_id=chatkit_id,
                    created_at=created_at,
                    text=text,
                )
                if message is None:
                    continue
                await store.add_thread_item(thread_id, message, self._chatkit_context)
                await self._mark_voice_messages_created()
            else:
                created_at = self._chatkit_item_created_at.get(realtime_id)
                if created_at is None:
                    created_at = datetime.now(timezone.utc)
                    self._chatkit_item_created_at[realtime_id] = created_at
                message = self._build_chatkit_message(
                    role=role,
                    message_id=chatkit_id,
                    created_at=created_at,
                    text=text,
                )
                if message is None:
                    continue
                await store.save_item(thread_id, message, self._chatkit_context)

    @staticmethod
    def _extract_text_from_realtime_item(
        item: RealtimeUserMessageItem | RealtimeAssistantMessageItem,
    ) -> str:
        text_parts: list[str] = []
        for entry in getattr(item, "content", []) or []:
            text_value = getattr(entry, "text", None)
            if isinstance(text_value, str) and text_value.strip():
                text_parts.append(text_value.strip())
                continue
            transcript_value = getattr(entry, "transcript", None)
            if isinstance(transcript_value, str) and transcript_value.strip():
                text_parts.append(transcript_value.strip())
        return "\n".join(text_parts).strip()

    def _build_chatkit_message(
        self,
        *,
        role: str,
        message_id: str,
        created_at: datetime,
        text: str,
    ) -> ChatKitUserMessageItem | ChatKitAssistantMessageItem | None:
        if self._thread_metadata is None:
            return None

        if role == "user":
            return ChatKitUserMessageItem(
                id=message_id,
                thread_id=self._thread_metadata.id,
                created_at=created_at,
                content=[UserMessageTextContent(text=text)],
                attachments=[],
                quoted_text=None,
                inference_options=InferenceOptions(),
            )

        if role == "assistant":
            return ChatKitAssistantMessageItem(
                id=message_id,
                thread_id=self._thread_metadata.id,
                created_at=created_at,
                content=[AssistantMessageContent(text=text)],
            )

        return None

    async def _mark_voice_messages_created(self) -> None:
        if self._voice_messages_marked:
            return
        if (
            self._chatkit_server is None
            or self._chatkit_context is None
            or self._thread_metadata is None
        ):
            return

        wait_state = _get_wait_state_metadata(self._thread_metadata)
        if not wait_state or wait_state.get("type") != "voice":
            self._voice_messages_marked = True
            return

        if wait_state.get("voice_messages_created"):
            self._voice_messages_marked = True
            return

        updated_wait_state = dict(wait_state)
        updated_wait_state["voice_messages_created"] = True
        _set_wait_state_metadata(self._thread_metadata, updated_wait_state)

        try:
            await self._chatkit_server.store.save_thread(
                self._thread_metadata,
                self._chatkit_context,
            )
        except Exception:
            logger.exception(
                "Impossible de marquer le thread %s comme ayant des messages vocaux",
                self._thread_metadata.id,
            )
        else:
            self._voice_messages_marked = True

    def transcripts(self) -> list[dict[str, Any]]:
        history = self.history
        transcripts: list[dict[str, Any]] = []
        ordered_ids: list[str] = []
        by_id: dict[str, dict[str, Any]] = {}

        for item in history:
            if item.get("type") != "message":
                continue
            role = item.get("role")
            if role not in {"user", "assistant"}:
                continue
            status_raw = str(item.get("status") or "").strip()
            if status_raw and status_raw not in {"completed", "in_progress"}:
                continue

            contents = item.get("content") or []
            text_parts: list[str] = []
            for content_item in contents:
                if not isinstance(content_item, Mapping):
                    continue
                content_type = content_item.get("type")
                if content_type in {"input_text", "output_text", "text"}:
                    text_value = content_item.get("text")
                elif content_type in {"input_audio", "output_audio", "audio"}:
                    text_value = content_item.get("transcript")
                else:
                    text_value = None
                if isinstance(text_value, str) and text_value.strip():
                    text_parts.append(text_value.strip())

            if not text_parts:
                continue

            fallback_id = item.get("item_id") or item.get("id")
            identifier = str(fallback_id or f"{role}-{len(ordered_ids)}")
            payload = {
                "id": identifier,
                "role": role,
                "text": "\n".join(text_parts),
            }
            if status_raw:
                payload["status"] = status_raw

            by_id[identifier] = payload
            if identifier not in ordered_ids:
                ordered_ids.append(identifier)

        for identifier in ordered_ids:
            entry = by_id.get(identifier)
            if entry:
                transcripts.append(entry)

        return transcripts

    async def send_audio(self, pcm: bytes, *, commit: bool) -> None:
        await self.ensure_session_started()
        async with self._send_lock:
            if self._session is None:
                raise RuntimeError("Realtime session not ready")
            await self._session.send_audio(pcm, commit=commit)

    async def interrupt(self) -> None:
        await self.ensure_session_started()
        async with self._send_lock:
            if self._session is None:
                return
            await self._session.interrupt()

    def should_log_input_audio(self, *, commit: bool) -> bool:
        """Réduit le bruit de logs en ne journalisant que les évènements pertinents."""
        if commit:
            self._input_audio_log_skip = 0
            return True
        if self._input_audio_log_skip == 0:
            self._input_audio_log_skip = 1
            return True
        self._input_audio_log_skip += 1
        if self._input_audio_log_skip >= 10:
            self._input_audio_log_skip = 1
            return True
        return False

    def _serialize_event(self, event: Any) -> dict[str, Any] | None:
        if isinstance(event, RealtimeHistoryUpdated):
            self.history = [item.model_dump(mode="json") for item in event.history]
            return {"type": "history", "history": self.history}

        if isinstance(event, RealtimeHistoryAdded):
            payload = event.item.model_dump(mode="json")
            self.history.append(payload)
            return {"type": "history_delta", "item": payload}

        if isinstance(event, RealtimeAudio):
            audio_event = event.audio
            encoded = base64.b64encode(audio_event.data).decode("ascii")
            return {
                "type": "audio",
                "item_id": event.item_id,
                "content_index": event.content_index,
                "response_id": getattr(audio_event, "response_id", None),
                "data": encoded,
            }

        if isinstance(event, RealtimeAudioEnd):
            return {
                "type": "audio_end",
                "item_id": event.item_id,
                "content_index": event.content_index,
            }

        if isinstance(event, RealtimeAudioInterrupted):
            return {
                "type": "audio_interrupted",
                "item_id": event.item_id,
                "content_index": event.content_index,
            }

        if isinstance(event, RealtimeError):
            return {"type": "session_error", "error": _json_safe(event.error)}

        if isinstance(event, RealtimeAgentStartEvent):
            return {"type": "agent_start"}

        if isinstance(event, RealtimeAgentEndEvent):
            return {"type": "agent_end"}

        if isinstance(event, RealtimeHandoffEvent):
            return {
                "type": "handoff",
                "to_agent": getattr(event.to_agent, "name", None),
            }

        if isinstance(event, RealtimeToolStart):
            return {"type": "tool_start", "tool": getattr(event.tool, "name", None)}

        if isinstance(event, RealtimeToolEnd):
            return {
                "type": "tool_end",
                "tool": getattr(event.tool, "name", None),
                "output": _json_safe(event.output),
            }

        return None


class RealtimeSessionGateway:
    """Gestionnaire centralisé des sessions Realtime côté backend."""

    def __init__(self) -> None:
        self._sessions: dict[str, _RealtimeSessionState] = {}
        self._user_connections: dict[str, set[GatewayConnection]] = defaultdict(set)
        self._lock = asyncio.Lock()

    async def register_session(self, handle: VoiceSessionHandle) -> None:
        logger.info(
            "Gateway: registering voice session %s for user %s",
            handle.session_id,
            handle.metadata.get("user_id"),
        )
        state = await self._get_or_create_state(handle)
        await self._broadcast_session_created(state)

    async def unregister_session(
        self, *, session_id: str | None = None, handle: VoiceSessionHandle | None = None
    ) -> None:
        target_id = session_id or (handle.session_id if handle else None)
        if not target_id:
            return

        async with self._lock:
            state = self._sessions.pop(target_id, None)

        if state is None:
            return

        logger.info(
            "Gateway: unregister session %s (user=%s)",
            target_id,
            state.owner_user_id,
        )
        await state.shutdown()
        await self.broadcast_session_event(
            state,
            {
                "type": "session_closed",
            },
        )

    async def _get_or_create_state(
        self, handle: VoiceSessionHandle
    ) -> _RealtimeSessionState:
        async with self._lock:
            state = self._sessions.get(handle.session_id)
            if state is None:
                state = _RealtimeSessionState(handle, self)
                self._sessions[handle.session_id] = state
        return state

    async def register_connection(self, connection: GatewayConnection) -> None:
        logger.info(
            "Gateway: registering connection %s for user %s",
            connection.id,
            connection.user_id,
        )
        async with self._lock:
            self._user_connections[connection.user_id].add(connection)

        await self._send_existing_sessions(connection)

    async def unregister_connection(self, connection: GatewayConnection) -> None:
        logger.info(
            "Gateway: unregistering connection %s for user %s",
            connection.id,
            connection.user_id,
        )
        async with self._lock:
            connections = self._user_connections.get(connection.user_id)
            if connections is not None:
                connections.discard(connection)
                if not connections:
                    self._user_connections.pop(connection.user_id, None)

        async with self._lock:
            states = list(self._sessions.values())
        for state in states:
            await state.remove_listener(connection)

    async def _send_existing_sessions(self, connection: GatewayConnection) -> None:
        async with self._lock:
            states = [
                state
                for state in self._sessions.values()
                if state.owner_user_id == connection.user_id
            ]

        for state in states:
            await connection.send_json(self._session_created_payload(state))
            await state.add_listener(connection)

    def _session_created_payload(self, state: _RealtimeSessionState) -> dict[str, Any]:
        return {
            "type": "session_created",
            "session_id": state.handle.session_id,
            "thread_id": state.thread_id,
            "session": state.session_payload(),
        }

    async def _broadcast_session_created(self, state: _RealtimeSessionState) -> None:
        payload = self._session_created_payload(state)
        await self._broadcast_to_user(state.owner_user_id, payload)

    async def _broadcast_to_user(
        self, user_id: str, payload: Mapping[str, Any]
    ) -> None:
        if not user_id:
            return
        async with self._lock:
            connections = list(self._user_connections.get(user_id, ()))

        for connection in connections:
            try:
                await connection.send_json(payload)
            except RuntimeError:  # pragma: no cover - websocket déjà fermé
                continue

    async def broadcast_session_event(
        self, state: _RealtimeSessionState, payload: Mapping[str, Any]
    ) -> None:
        message = dict(payload)
        message.setdefault("session_id", state.handle.session_id)
        await self._broadcast_to_user(state.owner_user_id, message)

    async def handle_session_stream_closed(self, state: _RealtimeSessionState) -> None:
        # Ne rien faire ici : la fermeture sera propagée lors de unregister_session.
        return

    async def handle_message(
        self, connection: GatewayConnection, payload: Mapping[str, Any]
    ) -> None:
        message_type = payload.get("type")
        session_id = payload.get("session_id")
        if not isinstance(session_id, str) or not session_id:
            await connection.send_json(
                {"type": "error", "error": "session_id manquant"}
            )
            logger.warning(
                "Gateway: payload sans session_id reçu sur %s: %s",
                connection.id,
                payload,
            )
            return

        state = await self._get_state_for_user(session_id, connection.user_id)
        if state is None:
            await connection.send_json(
                {"type": "error", "error": "Session vocale introuvable"}
            )
            logger.warning(
                "Gateway: session %s introuvable pour user %s (message %s)",
                session_id,
                connection.user_id,
                message_type,
            )
            return

        if message_type == "input_audio":
            data = payload.get("data")
            if not isinstance(data, str):
                await connection.send_json(
                    {"type": "error", "error": "Audio manquant"}
                )
                return
            try:
                chunk = base64.b64decode(data)
            except (ValueError, TypeError):
                await connection.send_json(
                    {"type": "error", "error": "Audio invalide"}
                )
                return
            commit = bool(payload.get("commit"))
            if state.should_log_input_audio(commit=commit):
                logger.debug(
                    "Gateway: input_audio reçu session=%s bytes=%d commit=%s",
                    session_id,
                    len(chunk),
                    commit,
                )
            await state.send_audio(chunk, commit=commit)
            return

        if message_type == "interrupt":
            logger.info(
                "Gateway: interrupt session=%s via connection=%s",
                session_id,
                connection.id,
            )
            await state.interrupt()
            return

        if message_type == "finalize":
            thread_id = payload.get("thread_id") or state.thread_id
            if not isinstance(thread_id, str) or not thread_id:
                await connection.send_json(
                    {"type": "error", "error": "thread_id manquant"}
                )
                return

            logger.info(
                "Gateway: finalize session=%s thread=%s via connection=%s",
                session_id,
                thread_id,
                connection.id,
            )
            transcripts = state.transcripts()
            settings = get_settings()
            context = build_chatkit_request_context(
                connection.user,
                request=None,
                public_base_url=settings.backend_public_base_url,
                authorization=connection.authorization,
            )
            await finalize_voice_wait_state(
                thread_id=thread_id,
                transcripts=transcripts,
                context=context,
                current_user=connection.user,
            )

            try:
                from .realtime_runner import close_voice_session

                await close_voice_session(session_id=session_id)
            except Exception:  # pragma: no cover - nettoyage best effort
                logger.debug("Fermeture de session Realtime échouée", exc_info=True)

            await self.unregister_session(session_id=session_id, handle=state.handle)
            await self._broadcast_to_user(
                state.owner_user_id,
                {
                    "type": "session_finalized",
                    "session_id": session_id,
                    "thread_id": thread_id,
                    "transcripts": transcripts,
                },
            )
            return

        await connection.send_json(
            {"type": "error", "error": f"Type de message inconnu: {message_type}"}
        )

    async def _get_state_for_user(
        self, session_id: str, user_id: str
    ) -> _RealtimeSessionState | None:
        async with self._lock:
            state = self._sessions.get(session_id)
        if state and state.owner_user_id == user_id:
            return state

        handle = await get_voice_session_handle(session_id)
        if handle is None:
            return None
        state = await self._get_or_create_state(handle)
        if state.owner_user_id != user_id:
            return None
        return state

    async def serve(self, connection: GatewayConnection) -> None:
        await self.register_connection(connection)
        try:
            while True:
                message = await connection.websocket.receive()
                logger.debug(
                    "Gateway: raw frame reçu connection=%s keys=%s payload=%s",
                    connection.id,
                    list(message.keys()),
                    {
                        key: message.get(key)
                        for key in ("type", "code", "reason")
                        if key in message
                    },
                )
                message_type = message.get("type")
                if message_type == "websocket.disconnect":
                    logger.info(
                        "Gateway: connexion %s fermée par le client",
                        connection.id,
                    )
                    break
                if "text" in message:
                    try:
                        payload = json.loads(message["text"])
                    except json.JSONDecodeError:
                        await connection.send_json(
                            {"type": "error", "error": "Message JSON invalide"}
                        )
                        continue
                    if isinstance(payload, Mapping):
                        await self.handle_message(connection, payload)
                    else:
                        await connection.send_json(
                            {"type": "error", "error": "Format de message inattendu"}
                        )
                else:
                    await connection.send_json(
                        {"type": "error", "error": "Format de trame non pris en charge"}
                    )
        except WebSocketDisconnect:
            logger.debug("Connexion WebSocket voix terminée (%s)", connection.user_id)
        finally:
            await self.unregister_connection(connection)


_GATEWAY: RealtimeSessionGateway | None = None


def get_realtime_gateway() -> RealtimeSessionGateway:
    global _GATEWAY
    if _GATEWAY is None:
        _GATEWAY = RealtimeSessionGateway()
    return _GATEWAY


__all__ = [
    "RealtimeSessionGateway",
    "get_realtime_gateway",
    "GatewayConnection",
    "GatewayUser",
]
