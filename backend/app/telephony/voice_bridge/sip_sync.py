"""Synchronization helpers between SIP (PJSUA) and the realtime session."""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

logger = logging.getLogger("chatkit.telephony.voice_bridge.sip")


class SipSyncController:
    """Coordinate speak-first and audio bridge priming for SIP calls."""

    def __init__(
        self,
        *,
        speak_first: bool,
        audio_bridge: Any | None,
        clear_audio_queue: callable | None,
        pjsua_ready_to_consume: asyncio.Event | None,
    ) -> None:
        self._speak_first = speak_first
        self._audio_bridge = audio_bridge
        self._clear_audio_queue = clear_audio_queue
        self._pjsua_ready_to_consume = pjsua_ready_to_consume
        self._response_create_sent = False

    @property
    def response_create_sent(self) -> bool:
        return self._response_create_sent

    async def prepare_session(self, session: Any) -> None:
        """Handle speak-first preparation before the audio stream starts."""

        if not self._speak_first:
            return

        if self._pjsua_ready_to_consume is None:
            logger.info(
                "⏳ Mode speak_first activé - response.create sera envoyé après amorçage du canal",
            )
            return

        logger.info(
            "⏳ Attente que PJSUA soit prêt à consommer l'audio avant speak_first...",
        )
        try:
            await asyncio.wait_for(self._pjsua_ready_to_consume.wait(), timeout=5.0)
        except asyncio.TimeoutError:
            logger.warning("⚠️ Timeout en attendant PJSUA")
            return

        logger.info("✅ PJSUA prêt - envoi IMMÉDIAT de response.create (sans attendre RTP)")

        if self._clear_audio_queue is not None:
            try:
                cleared_count = self._clear_audio_queue()
                logger.info(
                    "🗑️ Queue locale PJSUA vidée: %d frames de silence supprimées",
                    cleared_count,
                )
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Erreur lors du vidage de la queue PJSUA: %s", exc)
        else:
            logger.warning("⚠️ clear_audio_queue est None - impossible de vider la queue!")

        await self._send_response_create(session, immediate=True)
        logger.info(
            "⏸️ Audio output restera désactivé jusqu'au premier chunk TTS (évite starvation)",
        )

    async def on_first_rtp_packet(self, session: Any) -> None:
        """Fallback to send response.create once bidirectional audio is confirmed."""

        if not self._speak_first or self._response_create_sent:
            return

        num_silence_frames = 12
        logger.info(
            "🔇 Canal bidirectionnel confirmé - injection directe de %d frames de silence (%dms prime pour stabilité)",
            num_silence_frames,
            num_silence_frames * 20,
        )
        if self._audio_bridge:
            try:
                self._audio_bridge.send_prime_silence_direct(num_frames=num_silence_frames)
                logger.info(
                    "✅ Pipeline audio amorcé avec %d frames de silence (injection directe)",
                    num_silence_frames,
                )
                self._audio_bridge.enable_audio_output()
                logger.info("🔓 Envoi audio TTS déverrouillé après amorçage")
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("⚠️ Erreur lors de l'amorçage audio: %s", exc)
        else:
            logger.warning("⚠️ audio_bridge n'est pas disponible pour l'injection de silence")

        await self._send_response_create(session, immediate=False)

    def handle_first_tts_chunk(self, pcm_data: bytes) -> None:
        """Prime the audio bridge when the first TTS chunk is received."""

        if not self._audio_bridge:
            return

        if getattr(self._audio_bridge, "_t2_first_tts_chunk", None) is None:
            self._audio_bridge._t2_first_tts_chunk = time.monotonic()
            if getattr(self._audio_bridge, "_t1_response_create", None) is not None:
                delta = (
                    self._audio_bridge._t2_first_tts_chunk
                    - self._audio_bridge._t1_response_create
                ) * 1000
                logger.info(
                    "🎵 [t2=%.3fs, Δt1→t2=%.1fms] Premier chunk TTS reçu (%d bytes)",
                    self._audio_bridge._t2_first_tts_chunk,
                    delta,
                    len(pcm_data),
                )
                self._record_first_tts_metric(delta, len(pcm_data))

            num_silence_frames = 12
            try:
                self._audio_bridge.send_prime_silence_direct(num_frames=num_silence_frames)
                logger.info("✅ Ring buffer amorcé avec %d frames de silence", num_silence_frames)
                self._audio_bridge.enable_audio_output()
                logger.info("🔓 Audio output activé (premier chunk TTS reçu)")
            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Erreur lors de l'amorçage du ring buffer: %s", exc)

    def _record_first_tts_metric(self, delta_ms: float, size: int) -> None:
        if not hasattr(self._audio_bridge, "_chatkit_call_id") or not self._audio_bridge._chatkit_call_id:
            return
        try:
            from ..call_diagnostics import get_diagnostics_manager

            diag_manager = get_diagnostics_manager()
            diag = diag_manager.get_call(self._audio_bridge._chatkit_call_id)
            if diag:
                diag.phase_first_tts.duration_ms = delta_ms
                diag.phase_first_tts.metadata = {"delay_ms": delta_ms, "bytes": size}
                logger.info("⏱️ Phase 'first_tts' enregistrée: %.1fms", delta_ms)
        except Exception as exc:  # pragma: no cover - diagnostics best effort
            logger.debug("Impossible d'enregistrer la phase first_tts: %s", exc)

    async def _send_response_create(self, session: Any, *, immediate: bool) -> None:
        if self._response_create_sent:
            return
        try:
            from agents.realtime.model_inputs import (
                RealtimeModelRawClientMessage,
                RealtimeModelSendRawMessage,
            )

            await session._model.send_event(  # type: ignore[protected-access]
                RealtimeModelSendRawMessage(
                    message=RealtimeModelRawClientMessage(
                        type="response.create",
                        other_data={},
                    )
                )
            )
            self._response_create_sent = True
            if self._audio_bridge is not None:
                self._audio_bridge._t1_response_create = time.monotonic()
                if getattr(self._audio_bridge, "_t0_first_rtp", None) is not None:
                    delta = (
                        self._audio_bridge._t1_response_create
                        - self._audio_bridge._t0_first_rtp
                    ) * 1000
                    logger.info(
                        "✅ [t1=%.3fs, Δt0→t1=%.1fms] response.create envoyé après amorçage",
                        self._audio_bridge._t1_response_create,
                        delta,
                    )
                else:
                    logger.info(
                        "✅ [t1=%.3fs] response.create envoyé",
                        self._audio_bridge._t1_response_create,
                    )
                self._record_response_create_phase()
        except Exception as exc:
            if immediate:
                logger.warning("⚠️ Erreur lors de l'envoi immédiat de response.create: %s", exc)
            else:
                logger.warning("⚠️ Erreur lors de l'amorçage et envoi response.create: %s", exc)

    def _record_response_create_phase(self) -> None:
        if not hasattr(self._audio_bridge, "_chatkit_call_id") or not self._audio_bridge._chatkit_call_id:
            return
        try:
            from ..call_diagnostics import get_diagnostics_manager

            diag_manager = get_diagnostics_manager()
            diag = diag_manager.get_call(self._audio_bridge._chatkit_call_id)
            if diag:
                diag.phase_response_create.start()
                diag.phase_response_create.end()
        except Exception as exc:  # pragma: no cover - diagnostics best effort
            logger.debug("Impossible d'enregistrer la phase response.create: %s", exc)
