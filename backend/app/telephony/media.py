"""Audio related primitives built on top of :mod:`pjsua2`."""
# ruff: noqa: E501

from __future__ import annotations

import asyncio
import queue
from typing import TYPE_CHECKING, Any

from .async_helpers import schedule_coroutine_from_thread
from .call_diagnostics import CallDiagnostics
from .pjsua_lib import PJSUA_AVAILABLE, logger, pj

if TYPE_CHECKING:  # pragma: no cover - imported only for typing
    from .pjsua_adapter import PJSUAAdapter


class AudioMediaPort(pj.AudioMediaPort if PJSUA_AVAILABLE else object):
    """Port audio personnalisé pour capturer et injecter l'audio."""

    def __init__(
        self,
        adapter: PJSUAAdapter,
        frame_requested_event: asyncio.Event | None = None,
        audio_bridge: Any | None = None,
        diagnostics: CallDiagnostics | None = None,
    ):
        if not PJSUA_AVAILABLE:
            return

        self.adapter = adapter
        self._frame_requested_event = frame_requested_event
        self._audio_bridge = audio_bridge
        self._diagnostics: CallDiagnostics | None = diagnostics
        self.sample_rate = 8000
        self.channels = 1
        self.samples_per_frame = 160
        self.bits_per_sample = 16

        self._incoming_audio_queue = queue.Queue(maxsize=100)
        self._outgoing_audio_queue = queue.Queue(maxsize=1000)

        self._frame_count = 0
        self._audio_frame_count = 0
        self._silence_frame_count = 0
        self._frame_received_count = 0
        self._active = True
        self._reuse_count = 0

        super().__init__()

        audio_fmt = pj.MediaFormatAudio()
        audio_fmt.clockRate = self.sample_rate
        audio_fmt.channelCount = self.channels
        audio_fmt.bitsPerSample = self.bits_per_sample
        audio_fmt.frameTimeUsec = 20000
        audio_fmt.avgBps = self.sample_rate * self.channels * self.bits_per_sample
        audio_fmt.maxBps = audio_fmt.avgBps
        audio_fmt.init(
            pj.PJMEDIA_FORMAT_L16,
            self.sample_rate,
            self.channels,
            20000,
            self.bits_per_sample,
            self.sample_rate * self.channels * self.bits_per_sample,
            self.sample_rate * self.channels * self.bits_per_sample,
        )

        self.createPort("chatkit_audio", audio_fmt)

        self.prepare_for_new_call(
            frame_requested_event,
            audio_bridge,
            diagnostics=diagnostics,
        )

    def onFrameRequested(self, frame: pj.MediaFrame) -> None:  # noqa: N802 - API from pjsua2
        if not PJSUA_AVAILABLE:
            return

        if not self._active:
            expected_size = self.samples_per_frame * 2
            frame.buf.clear()
            for _ in range(expected_size):
                frame.buf.append(0)
            frame.size = expected_size
            frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO
            return

        diag = getattr(self, "_diagnostics", None)
        if diag is not None:
            frame_count = diag.record_frame_requested()
            self._frame_count = frame_count
        else:
            self._frame_count += 1
            frame_count = self._frame_count

        if frame_count == 1 and self._frame_requested_event and not self._frame_requested_event.is_set():
            logger.info(
                "🎬 Premier onFrameRequested - PJSUA est prêt à consommer l'audio (mode %s)",
                "PULL" if self._audio_bridge else "PUSH",
            )
            self._frame_requested_event.set()

        expected_size = self.samples_per_frame * 2

        if self._audio_bridge:
            try:
                audio_data = self._audio_bridge.get_next_frame_8k()
                is_silence = all(b == 0 for b in audio_data[: min(20, len(audio_data))])

                if diag is not None:
                    total_frames, silence_frames = diag.record_outgoing_frame(is_silence=is_silence)
                    self._audio_frame_count = total_frames
                    self._silence_frame_count = silence_frames
                else:
                    self._audio_frame_count += 1
                    if is_silence:
                        self._silence_frame_count += 1

                if not is_silence:
                    if self._audio_frame_count <= 5 or (self._audio_frame_count <= 20):
                        logger.info("📢 PULL #%d: audio frame (%d bytes)", frame_count, len(audio_data))

                if len(audio_data) < expected_size:
                    audio_data += b"\x00" * (expected_size - len(audio_data))
                elif len(audio_data) > expected_size:
                    audio_data = audio_data[:expected_size]

                frame.buf.clear()
                for byte in audio_data:
                    frame.buf.append(byte)

                frame.size = len(audio_data)
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

            except Exception as exc:  # pragma: no cover - defensive logging
                logger.warning("Erreur PULL get_next_frame_8k: %s, envoi silence", exc)
                if diag is not None:
                    _, silence_frames = diag.record_outgoing_frame(is_silence=True)
                    self._silence_frame_count = silence_frames
                    self._audio_frame_count = diag.outgoing_audio_frames
                else:
                    self._silence_frame_count += 1
                    self._audio_frame_count += 1
                frame.buf.clear()
                for _ in range(expected_size):
                    frame.buf.append(0)
                frame.size = expected_size
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

        else:
            try:
                audio_data = self._outgoing_audio_queue.get_nowait()
                is_silence = all(b == 0 for b in audio_data[: min(20, len(audio_data))])

                if diag is not None:
                    total_frames, silence_frames = diag.record_outgoing_frame(is_silence=is_silence)
                    self._audio_frame_count = total_frames
                    self._silence_frame_count = silence_frames
                else:
                    self._audio_frame_count += 1
                    if is_silence:
                        self._silence_frame_count += 1

                if self._audio_frame_count <= 5 or (self._audio_frame_count <= 20 and not is_silence):
                    logger.info(
                        "📢 PUSH #%d: audio trouvé (%d bytes) - %s",
                        frame_count,
                        len(audio_data),
                        "SILENCE" if is_silence else f"AUDIO (premiers bytes: {list(audio_data[:10])})",
                    )

                if len(audio_data) < expected_size:
                    audio_data += b"\x00" * (expected_size - len(audio_data))
                elif len(audio_data) > expected_size:
                    audio_data = audio_data[:expected_size]

                frame.buf.clear()
                for byte in audio_data:
                    frame.buf.append(byte)

                frame.size = len(audio_data)
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

            except queue.Empty:
                if diag is not None:
                    _, silence_frames = diag.record_outgoing_frame(is_silence=True)
                    self._silence_frame_count = silence_frames
                    self._audio_frame_count = diag.outgoing_audio_frames
                else:
                    self._silence_frame_count += 1
                    self._audio_frame_count += 1

                if self._silence_frame_count <= 5 or self._silence_frame_count % 50 == 0:
                    logger.debug(
                        "🔇 PUSH #%d: queue vide, envoi silence (total silence: %d)",
                        frame_count,
                        self._silence_frame_count,
                    )

                frame.buf.clear()
                for _ in range(expected_size):
                    frame.buf.append(0)

                frame.size = expected_size
                frame.type = pj.PJMEDIA_FRAME_TYPE_AUDIO

    def onFrameReceived(self, frame: pj.MediaFrame) -> None:  # noqa: N802 - API from pjsua2
        if not PJSUA_AVAILABLE:
            return

        diag = getattr(self, "_diagnostics", None)
        if diag is not None:
            received_count = diag.record_incoming_frame()
            self._frame_received_count = received_count
        else:
            if not hasattr(self, "_frame_received_count"):
                self._frame_received_count = 0
            self._frame_received_count += 1
            received_count = self._frame_received_count

        if received_count <= 10:
            logger.info(
                "📥 onFrameReceived appelé #%d: type=%s, size=%d, buf_len=%d",
                received_count,
                frame.type,
                frame.size,
                len(frame.buf) if frame.buf else 0,
            )

        if frame.type == pj.PJMEDIA_FRAME_TYPE_AUDIO and frame.buf:
            try:
                audio_pcm = bytes(frame.buf[: frame.size])
                self._incoming_audio_queue.put_nowait(audio_pcm)

                if received_count <= 5:
                    logger.info(
                        "✅ Frame #%d ajoutée à queue (%d bytes, queue=%d)",
                        received_count,
                        len(audio_pcm),
                        self._incoming_audio_queue.qsize(),
                    )

                if hasattr(self.adapter, "_on_audio_received"):
                    schedule_coroutine_from_thread(
                        self.adapter._on_audio_received(audio_pcm),
                        self.adapter._loop,
                        callback_name="onAudioReceived",
                        logger=logger,
                    )
            except queue.Full:
                logger.warning("Queue audio entrante pleine, frame ignorée")
        else:
            if received_count <= 10:
                logger.warning("⚠️ Frame reçue mais type=%s ou buf vide", frame.type)

    def send_audio(self, audio_data: bytes) -> None:
        try:
            diag = getattr(self, "_diagnostics", None)
            self._outgoing_audio_queue.put_nowait(audio_data)

            queue_size = self._outgoing_audio_queue.qsize()
            audio_counter = diag.outgoing_audio_frames if diag else self._audio_frame_count
            if audio_counter < 5:
                is_silence = all(b == 0 for b in audio_data[: min(20, len(audio_data))])
                logger.info(
                    "📥 send_audio: %d bytes ajoutés à queue (taille: %d) - %s",
                    len(audio_data),
                    queue_size,
                    "SILENCE" if is_silence else f"AUDIO (premiers bytes: {list(audio_data[:10])})",
                )
        except queue.Full:
            logger.warning("⚠️ Queue audio sortante pleine, frame ignorée")

    async def get_audio(self) -> bytes | None:
        try:
            return self._incoming_audio_queue.get_nowait()
        except queue.Empty:
            return None

    def clear_incoming_audio_queue(self) -> int:
        count = 0
        try:
            while True:
                self._incoming_audio_queue.get_nowait()
                count += 1
        except queue.Empty:
            pass
        return count

    def clear_outgoing_audio_queue(self) -> int:
        count = 0
        try:
            while True:
                self._outgoing_audio_queue.get_nowait()
                count += 1
        except queue.Empty:
            pass

        if count > 0:
            logger.info("🗑️  Queue audio sortante vidée: %d frames supprimées", count)

        return count

    def disable(self) -> None:
        self._active = False

    def deactivate(self, destroy_port: bool = False) -> None:
        if not PJSUA_AVAILABLE:
            return

        try:
            super().deactivate(destroy_port)
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Ignorer erreur deactivate: %s", exc)

        self._active = False

    def destroy(self) -> None:
        if not PJSUA_AVAILABLE:
            return

        try:
            super().destroy()
        except Exception as exc:  # pragma: no cover - defensive logging
            logger.debug("Ignorer erreur destroyPort: %s", exc)

    def prepare_for_pool(self) -> None:
        import time

        already_disabled = not self._active
        if not already_disabled:
            self.deactivate(destroy_port=False)
            logger.debug("prepare_for_pool: port n'était pas désactivé, deactivate() appelé")
        else:
            logger.debug("prepare_for_pool: port déjà désactivé via disable(), skip deactivate()")

        self._frame_requested_event = None
        self._audio_bridge = None

        drain_timeout = 0.1
        drain_start = time.monotonic()
        total_incoming_drained = 0
        total_outgoing_drained = 0

        logger.debug("prepare_for_pool: drain agressif de 100ms pour éliminer toute accumulation")

        while (time.monotonic() - drain_start) < drain_timeout:
            drained_this_pass = 0

            try:
                while True:
                    self._incoming_audio_queue.get_nowait()
                    drained_this_pass += 1
                    total_incoming_drained += 1
            except queue.Empty:
                pass

            try:
                while True:
                    self._outgoing_audio_queue.get_nowait()
                    drained_this_pass += 1
                    total_outgoing_drained += 1
            except queue.Empty:
                pass

            if drained_this_pass > 0:
                drain_start = time.monotonic()
                logger.debug("🔄 Active drain: cleared %d residual frames, continuing...", drained_this_pass)
            else:
                time.sleep(0.005)

        if total_incoming_drained > 0 or total_outgoing_drained > 0:
            logger.info(
                "✅ Drain agressif terminé: %d frames entrantes + %d frames sortantes vidées",
                total_incoming_drained,
                total_outgoing_drained,
            )

            if total_outgoing_drained > 50:
                logger.warning(
                    "⚠️ ACCUMULATION EXCESSIVE DÉTECTÉE: %d frames sortantes vidées (>50) - possible problème",
                    total_outgoing_drained,
                )

    def prepare_for_new_call(
        self,
        frame_requested_event: asyncio.Event | None,
        audio_bridge: Any | None = None,
        *,
        diagnostics: CallDiagnostics | None = None,
    ) -> None:
        if diagnostics is not None:
            self._diagnostics = diagnostics

        diag = self._diagnostics
        if diag is not None:
            diag.prepare_audio_port(self, frame_requested_event, audio_bridge)
        else:
            self._frame_requested_event = frame_requested_event
            self._audio_bridge = audio_bridge
            self._frame_count = 0
            self._audio_frame_count = 0
            self._silence_frame_count = 0
            self._frame_received_count = 0
            self._active = True

            try:
                while True:
                    self._incoming_audio_queue.get_nowait()
            except queue.Empty:
                pass

            try:
                while True:
                    self._outgoing_audio_queue.get_nowait()
            except queue.Empty:
                pass


__all__ = ["AudioMediaPort"]
