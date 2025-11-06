"""Realtime event routing for the telephony voice bridge."""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
from collections.abc import Awaitable, Callable
from typing import TYPE_CHECKING, Any

from agents.realtime.events import (
    RealtimeAgentEndEvent,
    RealtimeAgentStartEvent,
    RealtimeAudio,
    RealtimeAudioEnd,
    RealtimeAudioInterrupted,
    RealtimeError,
    RealtimeHistoryAdded,
    RealtimeHistoryUpdated,
    RealtimeToolEnd,
    RealtimeToolStart,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..voice_bridge import AudioRecorder, VoiceBridgeHooks
    from .sip_sync import SipSyncController

logger = logging.getLogger("chatkit.telephony.voice_bridge.events")


class RealtimeEventRouter:
    """Stream realtime SDK events and coordinate audio playback."""

    def __init__(
        self,
        *,
        session: Any,
        playback_tracker: Any,
        should_continue: Callable[[], bool],
        request_stop: Callable[[], Awaitable[None]],
        send_to_peer: Callable[[bytes], Awaitable[None]],
        clear_audio_queue: Callable[[], int] | None,
        hooks: VoiceBridgeHooks,
        transcripts: list[dict[str, str]],
        block_audio_send_ref: list[bool],
        audio_recorder: AudioRecorder | None,
        sip_sync: SipSyncController | None,
        error_factory: Callable[[str], Exception],
    ) -> None:
        self._session = session
        self._playback_tracker = playback_tracker
        self._should_continue = should_continue
        self._request_stop = request_stop
        self._send_to_peer = send_to_peer
        self._clear_audio_queue = clear_audio_queue
        self._hooks = hooks
        self._transcripts = transcripts
        self._block_audio_send_ref = block_audio_send_ref
        self._audio_recorder = audio_recorder
        self._sip_sync = sip_sync
        self._error_factory = error_factory

        self.outbound_audio_bytes = 0
        self.error: Exception | None = None

    async def run(self) -> None:
        """Consume SDK events and mirror them to SIP."""

        agent_is_speaking = False
        user_speech_detected = False
        tool_call_detected = False
        processed_history_texts: dict[str, str] = {}
        response_watchdog_tasks: list[asyncio.Task] = []
        audio_received_after_user_speech = False
        response_started_after_user_speech = False
        session = self._session
        playback_tracker = self._playback_tracker
        block_audio_send_ref = self._block_audio_send_ref
        clear_audio_queue = self._clear_audio_queue
        transcripts = self._transcripts

        async def force_response_if_silent() -> None:
            nonlocal audio_received_after_user_speech, response_started_after_user_speech
            try:
                await asyncio.sleep(0.1)
                if not audio_received_after_user_speech:
                    if response_started_after_user_speech:
                        logger.warning(
                            (
                                "⏱️ 0.1s sans audio détecté (function call sans préambule) - "
                                "forçage response.create avec audio"
                            ),
                        )
                        try:
                            from agents.realtime.model_inputs import (
                                RealtimeModelSendRawMessage,
                            )

                            await session._model.send_event(
                                RealtimeModelSendRawMessage(message={"type": "response.cancel"})
                            )
                            logger.info("🚫 Réponse sans audio annulée")
                        except Exception as exc:
                            logger.debug("response.cancel échoué: %s", exc)
                    else:
                        logger.warning(
                            "⏱️ 0.1s silence TOTAL détecté - forçage response.create",
                        )

                    try:
                        from agents.realtime.model_inputs import (
                            RealtimeModelRawClientMessage,
                            RealtimeModelSendRawMessage,
                        )

                        await session._model.send_event(
                            RealtimeModelSendRawMessage(
                                message=RealtimeModelRawClientMessage(
                                    type="response.create",
                                    other_data={},
                                )
                            )
                        )
                        logger.info("✅ response.create forcé pour garantir audio")
                    except Exception as exc:
                        logger.warning("Impossible de forcer response.create: %s", exc)
            except asyncio.CancelledError:
                logger.debug("Watchdog annulé - audio reçu à temps")

        try:
            async for event in session:
                if not self._should_continue():
                    break

                event_type = type(event).__name__

                if "tool" in event_type.lower() or "function" in event_type.lower():
                    logger.info("🔧 Event: %s - %s", event_type, event)

                if isinstance(event, RealtimeError):
                    error_code = getattr(event.error, "code", None)
                    if error_code == "response_cancel_not_active":
                        logger.debug(
                            "response.cancel ignoré (pas de réponse active): %s",
                            event.error,
                        )
                        continue
                    if error_code == "conversation_already_has_active_response":
                        logger.debug(
                            "response.create ignoré (réponse déjà active - turn_detection l'a créée): %s",
                            event.error,
                        )
                        continue
                    self.error = self._error_factory(str(event.error))
                    logger.error("Erreur Realtime API: %s", event.error)
                    break

                if event_type == "RealtimeRawModelEvent":
                    model_event = getattr(event, "data", None)
                    if model_event:
                        model_event_type = getattr(model_event, "type", None)
                        if model_event_type == "raw_server_event":
                            raw_data = getattr(model_event, "data", None)
                            if raw_data and isinstance(raw_data, dict):
                                event_subtype = raw_data.get("type", "")

                                if event_subtype == "input_audio_buffer.speech_started":
                                    logger.info("🎤 Utilisateur commence à parler")
                                    block_audio_send_ref[0] = True

                                    if clear_audio_queue:
                                        try:
                                            frames_cleared = clear_audio_queue()
                                        except Exception as exc:  # pragma: no cover - defensive logging
                                            logger.warning("Erreur lors du vidage de la queue PJSUA: %s", exc)
                                            frames_cleared = 0
                                        if frames_cleared > 0:
                                            logger.info(
                                                (
                                                    "🗑️  Audio queue vidée: %d frames supprimées "
                                                    "pour interruption rapide"
                                                ),
                                                frames_cleared,
                                            )

                                    if tool_call_detected:
                                        logger.debug(
                                            "Réinitialisation du tracking tool call "
                                            "(utilisateur parle)"
                                        )
                                        tool_call_detected = False
                                
                                    if agent_is_speaking:
                                        logger.info("🛑 Interruption de l'agent (agent parlait)!")
                                        try:
                                            await session.interrupt()
                                        except Exception as exc:
                                            logger.warning("Erreur lors de session.interrupt(): %s", exc)
                                    else:
                                        logger.info("🛑 Blocage audio (agent vient de finir)")
                                    user_speech_detected = True
                                    continue

                                if event_subtype == "input_audio_buffer.speech_stopped":
                                    logger.info("🎤 Utilisateur arrête de parler")
                                    user_speech_detected = False
                                    if not agent_is_speaking:
                                        block_audio_send_ref[0] = False
                                        logger.info("→ Déblocage audio (agent ne parle pas)")
                                    continue

                                if event_subtype == "response.mcp_call.completed":
                                    tool_payload = raw_data.get("mcp_call")
                                    tool_data = tool_payload if isinstance(tool_payload, dict) else {}
                                    tool_name = tool_data.get("name", "unknown")
                                    logger.info("🔧 Tool MCP terminé EN TEMPS RÉEL: %s", tool_name)
                                    await self._force_response_create()
                                    continue

                                if event_subtype == "response.function_call_arguments.done":
                                    function_name = raw_data.get("name", "unknown")
                                    logger.info("🔧 Function call terminé EN TEMPS RÉEL: %s", function_name)
                                    await self._force_response_create()
                                    continue

                                if event_subtype == "response.output_item.added":
                                    output_payload = raw_data.get("output_item")
                                    output_item = (
                                        output_payload if isinstance(output_payload, dict) else {}
                                    )
                                    output_type = output_item.get("type")
                                    if output_type == "function_call":
                                        logger.info(
                                            "🔧 Output function call détecté - "
                                            "confirmation requise"
                                        )
                                        await self._force_response_create()
                                    continue

                                if event_subtype == "response.created":
                                    response_started_after_user_speech = True
                                    logger.debug("🗣️ Nouvelle réponse générée (après détection parole utilisateur)")

                                    if user_speech_detected and not audio_received_after_user_speech:
                                        logger.debug("⏳ Watchdog démarré pour forcer audio en 0.1s")
                                        task = asyncio.create_task(force_response_if_silent())
                                        response_watchdog_tasks.append(task)
                                    continue

                if isinstance(event, RealtimeAudioInterrupted):
                    logger.info("🛑 Audio interrompu confirmé par OpenAI - blocage audio")
                    block_audio_send_ref[0] = True
                    try:
                        from agents.realtime.model_inputs import (
                            RealtimeModelSendRawMessage,
                        )

                        await session._model.send_event(
                            RealtimeModelSendRawMessage(message={"type": "response.cancel"})
                        )
                        logger.info("✅ Envoyé response.cancel")
                    except Exception as exc:
                        logger.debug("response.cancel ignoré: %s", exc)
                    continue

                if isinstance(event, RealtimeAudio):
                    if not audio_received_after_user_speech:
                        audio_received_after_user_speech = True
                        logger.debug("✅ Audio reçu - watchdog ne se déclenchera pas")

                    for watchdog_task in response_watchdog_tasks:
                        if not watchdog_task.done():
                            watchdog_task.cancel()
                    if response_watchdog_tasks:
                        logger.debug(
                            "✅ %d watchdog task(s) annulé(s) - agent parle vraiment",
                            len(response_watchdog_tasks),
                        )
                        response_watchdog_tasks.clear()

                    audio_event = event.audio
                    pcm_data = audio_event.data

                    if not block_audio_send_ref[0]:
                        if pcm_data and self._sip_sync is not None:
                            self._sip_sync.handle_first_tts_chunk(pcm_data)

                        if pcm_data:
                            self.outbound_audio_bytes += len(pcm_data)
                            logger.debug(
                                "🎵 Envoi de %d bytes d'audio vers téléphone",
                                len(pcm_data),
                            )
                            await self._send_to_peer(pcm_data)

                            if self._audio_recorder:
                                self._audio_recorder.write_outbound(pcm_data)

                            if self._hooks.on_audio_outbound:
                                try:
                                    await self._hooks.on_audio_outbound(pcm_data)
                                except Exception as exc:
                                    logger.error("Erreur lors du streaming audio sortant: %s", exc)

                            playback_tracker.on_play_bytes(
                                event.item_id,
                                event.content_index,
                                pcm_data,
                            )
                    else:
                        logger.debug("🛑 Audio bloqué (block_audio_send=%s)", block_audio_send_ref[0])
                    continue

                if isinstance(event, RealtimeAudioEnd):
                    continue

                if isinstance(event, RealtimeHistoryAdded | RealtimeHistoryUpdated):
                    history = getattr(event, "history", [event.item] if hasattr(event, "item") else [])
                    for idx, item in enumerate(history):
                        role = getattr(item, "role", None)
                        item_id = getattr(item, "id", None)

                        if isinstance(item_id, str) and item_id:
                            history_key = item_id
                        else:
                            history_key = f"{idx}_{role or 'unknown'}"

                        if item_id:
                            item_unique_id = item_id
                        else:
                            content_length = len(getattr(item, "content", []))
                            item_unique_id = f"{idx}_{role}_{content_length}"
                        item_type = getattr(item, "type", None)
                        contents = getattr(item, "content", [])
                        content_count = len(contents) if contents else 0
                        logger.info(
                            "📋 History item: role=%s, type=%s, id=%s, unique_id=%s, content_count=%d",
                            role,
                            item_type,
                            item_id,
                            item_unique_id,
                            content_count,
                        )

                        has_tool_call_content = False
                        if contents:
                            for content in contents:
                                content_type = getattr(content, "type", None)
                                if content_type in ("function_call", "tool_call", "function_call_output"):
                                    has_tool_call_content = True
                                    break

                        if role == "assistant" and (has_tool_call_content or item_type == "function_call"):
                            tool_call_detected = True
                            logger.debug(
                                "🔧 Tool call détecté dans l'historique (type=%s, has_tool_content=%s)",
                                item_type,
                                has_tool_call_content,
                            )

                        if contents:
                            for idx_content, content in enumerate(contents):
                                content_type = getattr(content, "type", None)
                                logger.info("  📄 Content[%d]: type=%s", idx_content, content_type)
                                if content_type in ("function_call", "tool_call", "function_call_output"):
                                    logger.info("    🔧 Tool content: %s", content)

                        if role not in ("user", "assistant"):
                            continue

                        text_parts: list[str] = []
                        for content in contents:
                            text = getattr(content, "text", None) or getattr(content, "transcript", None)
                            if isinstance(text, str) and text.strip():
                                text_parts.append(text.strip())

                        if text_parts:
                            combined_text = "\n".join(text_parts)

                            if processed_history_texts.get(history_key) == combined_text:
                                continue

                            transcript_entry = {"role": role, "text": combined_text}
                            transcripts.append(transcript_entry)
                            logger.info("💬 %s: %s", role.upper(), combined_text[:200])

                            if self._hooks.on_transcript:
                                try:
                                    await self._hooks.on_transcript(transcript_entry)
                                except Exception as exc:
                                    logger.error(
                                        "Erreur lors de l'envoi de la transcription en temps réel: %s",
                                        exc,
                                    )

                            processed_history_texts[history_key] = combined_text

                            if role == "assistant":
                                is_short = len(combined_text) < 30

                                if tool_call_detected and not is_short:
                                    logger.info(
                                        "✅ Confirmation détectée après tool call: %s",
                                        combined_text[:50],
                                    )
                                    tool_call_detected = False
                                elif tool_call_detected and is_short:
                                    logger.warning(
                                        "⚠️ Message court après tool call (probable préambule): %s",
                                        combined_text,
                                    )
                    continue

                if isinstance(event, RealtimeToolStart):
                    tool_name = getattr(event.tool, "name", None)
                    logger.info("Exécution de l'outil MCP: %s", tool_name)
                    continue

                if isinstance(event, RealtimeToolEnd):
                    tool_name = getattr(event.tool, "name", None)
                    output = event.output
                    logger.info("Outil MCP terminé: %s, résultat: %s", tool_name, output)
                    continue

                if isinstance(event, RealtimeAgentStartEvent):
                    agent_is_speaking = True
                    block_audio_send_ref[0] = False
                    logger.info("🗣️ Agent commence à parler - déblocage audio")
                    continue

                if isinstance(event, RealtimeAgentEndEvent):
                    agent_is_speaking = False
                    if not user_speech_detected:
                        block_audio_send_ref[0] = False
                        logger.info("🤖 Agent a fini de parler - audio débloqué")
                    continue

                logger.debug("📡 Event ignoré: %s", event_type)

        except Exception as exc:  # pragma: no cover - defensive logging
            logger.exception("Erreur dans le flux d'événements SDK")
            self.error = self._error_factory(f"Erreur événements SDK: {exc}")
        finally:
            for watchdog_task in response_watchdog_tasks:
                if not watchdog_task.done():
                    watchdog_task.cancel()
            if response_watchdog_tasks:
                logger.debug(
                    "🧹 Cleanup: %d watchdog task(s) annulé(s)",
                    len(response_watchdog_tasks),
                )
                response_watchdog_tasks.clear()
            await self._request_stop()

    async def _force_response_create(self) -> None:
        try:
            from agents.realtime.model_inputs import (
                RealtimeModelRawClientMessage,
                RealtimeModelSendRawMessage,
            )

            await self._session._model.send_event(  # type: ignore[protected-access]
                RealtimeModelSendRawMessage(
                    message=RealtimeModelRawClientMessage(
                        type="response.create",
                        other_data={},
                    )
                )
            )
            logger.info("✅ response.create envoyé")
        except Exception as exc:
            error_msg = str(exc).lower()
            if (
                "already has an active response" in error_msg
                or "conversation_already_has_active_response" in error_msg
            ):
                logger.debug("response.create ignoré (réponse déjà active): %s", exc)
            else:
                logger.warning("Erreur lors de l'envoi de response.create: %s", exc)
