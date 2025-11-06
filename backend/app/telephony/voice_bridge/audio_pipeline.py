"""Audio streaming helpers for the telephony voice bridge."""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pragma: no cover - typing only
    from ..voice_bridge import AudioRecorder, RtpPacket, VoiceBridgeHooks
    from .sip_sync import SipSyncController

logger = logging.getLogger("chatkit.telephony.voice_bridge.audio")


class AudioStreamManager:
    """Forward RTP audio to the Realtime session while tracking metrics."""

    def __init__(
        self,
        *,
        session: Any,
        rtp_stream: AsyncIterator[RtpPacket],
        decode_packet: Callable[[RtpPacket], bytes],
        should_continue: Callable[[], bool],
        request_stop: Callable[[], Awaitable[None]],
        inbound_audio_dispatcher: Any,
        hooks: VoiceBridgeHooks,
        audio_recorder: AudioRecorder | None,
        sip_sync: SipSyncController | None,
        audio_bridge: Any | None,
    ) -> None:
        self._session = session
        self._rtp_stream = rtp_stream
        self._decode_packet = decode_packet
        self._should_continue = should_continue
        self._request_stop = request_stop
        self._inbound_audio_dispatcher = inbound_audio_dispatcher
        self._hooks = hooks
        self._audio_recorder = audio_recorder
        self._sip_sync = sip_sync
        self._audio_bridge = audio_bridge

        self.inbound_audio_bytes = 0
        self.error: Exception | None = None

    async def stream(self) -> None:
        """Consume the RTP stream and forward decoded PCM to the SDK session."""

        packet_count = 0
        first_hook_dispatched_at: float | None = None
        browser_stream_metric_recorded = False

        try:
            async for packet in self._rtp_stream:
                packet_count += 1
                pcm = self._decode_packet(packet)
                if not pcm:
                    logger.debug("Paquet RTP #%d: décodage vide, ignoré", packet_count)
                    continue

                self.inbound_audio_bytes += len(pcm)

                if packet_count == 1:
                    logger.info("Premier paquet audio reçu: %d bytes PCM", len(pcm))
                    if self._sip_sync is not None:
                        await self._sip_sync.on_first_rtp_packet(self._session)

                hook_task: Awaitable[None] | None = None
                hook_dispatch_time: float | None = None
                if self._hooks.on_audio_inbound:
                    hook_dispatch_time = time.perf_counter()
                    if first_hook_dispatched_at is None and packet_count == 1:
                        first_hook_dispatched_at = hook_dispatch_time
                    try:
                        hook_task = self._inbound_audio_dispatcher.submit(
                            self._hooks.on_audio_inbound(pcm)
                        )
                    except asyncio.CancelledError:
                        raise
                    except Exception as exc:  # pragma: no cover - defensive logging
                        logger.error(
                            "Erreur lors de l'ordonnancement du streaming audio entrant: %s",
                            exc,
                        )

                send_audio_start = time.perf_counter()

                if hook_task is not None:
                    async with asyncio.TaskGroup() as tg:
                        tg.create_task(hook_task)
                        tg.create_task(self._session.send_audio(pcm, commit=False))
                else:
                    await self._session.send_audio(pcm, commit=False)

                if first_hook_dispatched_at is None and packet_count == 1:
                    first_hook_dispatched_at = hook_dispatch_time or send_audio_start

                if (
                    not browser_stream_metric_recorded
                    and packet_count == 1
                    and first_hook_dispatched_at is not None
                    and self._audio_bridge is not None
                    and hasattr(self._audio_bridge, "_chatkit_call_id")
                ):
                    browser_stream_metric_recorded = True
                    hook_lead_ms = (send_audio_start - first_hook_dispatched_at) * 1000
                    try:
                        from ..call_diagnostics import get_diagnostics_manager

                        diag_manager = get_diagnostics_manager()
                        diag = diag_manager.get_call(self._audio_bridge._chatkit_call_id)
                        if diag:
                            diag.phase_first_rtp.metadata["browser_stream_lead_ms"] = hook_lead_ms
                            logger.info(
                                "📊 Latence stream navigateur réduite: %.1fms d'avance",
                                hook_lead_ms,
                            )
                    except Exception as exc:  # pragma: no cover - diagnostics best effort
                        logger.debug("Impossible d'enregistrer la métrique navigateur: %s", exc)

                if self._audio_recorder:
                    self._audio_recorder.write_inbound(pcm)

                if not self._should_continue():
                    logger.info("forward_audio: arrêt demandé par should_continue()")
                    break

            logger.info(
                "forward_audio: fin de la boucle RTP stream (paquets reçus: %d)",
                packet_count,
            )
        except Exception as exc:
            self.error = exc
            raise
        finally:
            logger.debug("Fin du flux audio RTP, attente de la fermeture de session")
            await self._request_stop()

    def record(self) -> tuple[str | None, str | None, str | None]:
        """Finalize audio recordings and return file paths."""

        if not self._audio_recorder:
            return (None, None, None)
        try:
            return self._audio_recorder.close()
        except Exception as exc:  # pragma: no cover - logging only
            logger.error("Failed to close audio recorder: %s", exc)
            return (None, None, None)
