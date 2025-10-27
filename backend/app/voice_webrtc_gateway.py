"""Passerelle WebRTC vers la session Realtime vocale OpenAI."""

from __future__ import annotations

import asyncio
import audioop
import logging
import time
import uuid
from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from fractions import Fraction
from typing import Any

try:  # pragma: no cover - dépendances optionnelles en environnement test
    from aiortc import MediaStreamTrack, RTCPeerConnection, RTCSessionDescription
    from aiortc.mediastreams import MediaStreamError
    from av import AudioFrame
except ImportError:  # pragma: no cover - aiortc/av non installés
    RTCPeerConnection = None  # type: ignore[assignment]
    RTCSessionDescription = None  # type: ignore[assignment]
    MediaStreamTrack = None  # type: ignore[assignment]
    MediaStreamError = Exception  # type: ignore[assignment]
    AudioFrame = None  # type: ignore[assignment]

from .telephony.voice_bridge import RtpPacket, TelephonyVoiceBridge, VoiceBridgeStats

logger = logging.getLogger("chatkit.voice.webrtc")


class VoiceWebRTCGatewayError(RuntimeError):
    """Erreur générique de la passerelle WebRTC vocale."""


@dataclass
class VoiceWebRTCSessionResult:
    """Résultat d'une session WebRTC vocale une fois terminée."""

    stats: VoiceBridgeStats | None
    error: Exception | None = None


class _PcmAudioTrack(MediaStreamTrack):
    """Piste audio sortante alimentée par des chunks PCM 16 bits."""

    kind = "audio"

    def __init__(self, sample_rate: int) -> None:
        super().__init__()
        self._queue: asyncio.Queue[bytes | None] = asyncio.Queue()
        self._sample_rate = sample_rate
        self._pts = 0

    async def recv(self) -> AudioFrame:  # type: ignore[override]
        chunk = await self._queue.get()
        if chunk is None:
            raise MediaStreamError("Piste PCM arrêtée")

        samples = max(1, len(chunk) // 2)
        frame = AudioFrame(format="s16", layout="mono", samples=samples)
        frame.planes[0].update(chunk)
        frame.sample_rate = self._sample_rate
        frame.time_base = Fraction(1, self._sample_rate)
        frame.pts = self._pts
        self._pts += samples
        return frame

    async def send_pcm(self, pcm: bytes) -> None:
        if self.readyState == "ended":
            return
        await self._queue.put(pcm)

    def stop(self) -> None:  # type: ignore[override]
        if self.readyState != "ended":
            super().stop()
            try:
                self._queue.put_nowait(None)
            except asyncio.QueueFull:  # pragma: no cover - protection défensive
                pass


class VoiceWebRTCSession:
    """Session WebRTC encapsulant la boucle avec TelephonyVoiceBridge."""

    def __init__(
        self,
        *,
        bridge: TelephonyVoiceBridge,
        client_secret: str,
        model: str,
        instructions: str,
        voice: str | None,
        api_base: str | None = None,
        sample_rate: int = 24_000,
        on_complete: (
            Callable[[str, VoiceWebRTCSessionResult | None], None] | None
        ) = None,
    ) -> None:
        if RTCPeerConnection is None or RTCSessionDescription is None:
            raise VoiceWebRTCGatewayError(
                "La dépendance aiortc est requise pour gérer le pont WebRTC voix.",
            )

        self.session_id = str(uuid.uuid4())
        self._bridge = bridge
        self._client_secret = client_secret
        self._model = model
        self._instructions = instructions
        self._voice = voice
        self._api_base = api_base
        self._sample_rate = sample_rate
        self._pc = RTCPeerConnection()  # type: ignore[call-arg]
        self._outbound_track = _PcmAudioTrack(sample_rate)
        self._bridge_task: asyncio.Task[VoiceBridgeStats] | None = None
        self._result: asyncio.Future[VoiceBridgeStats] = (
            asyncio.get_event_loop().create_future()
        )
        self._closed = asyncio.Event()
        self._stop_called = False
        self._on_complete = on_complete
        self._start_time = time.monotonic()

        @self._pc.on("connectionstatechange")  # type: ignore[misc]
        async def _on_connection_state_change() -> None:
            state = self._pc.connectionState  # type: ignore[attr-defined]
            logger.debug("État RTCPeerConnection=%s", state)
            if state in {"failed", "closed"}:
                await self.stop()

        @self._pc.on("track")  # type: ignore[misc]
        async def _on_track(track: MediaStreamTrack) -> None:
            if track.kind != "audio":
                logger.debug("Piste %s ignorée", track.kind)
                return
            if self._bridge_task is not None:
                logger.debug("Piste audio additionnelle ignorée")
                return
            logger.info("Réception d'une piste audio distante, démarrage du pont voix")
            self._pc.addTrack(self._outbound_track)  # type: ignore[arg-type]
            self._bridge_task = asyncio.create_task(self._run_bridge(track))

    async def accept_offer(self, offer: RTCSessionDescription) -> RTCSessionDescription:
        await self._pc.setRemoteDescription(offer)
        answer = await self._pc.createAnswer()
        await self._pc.setLocalDescription(answer)
        return self._pc.localDescription  # type: ignore[return-value]

    async def stop(self) -> None:
        if self._stop_called:
            await self._closed.wait()
            return
        self._stop_called = True
        logger.debug("Arrêt de la session WebRTC voix %s", self.session_id)
        try:
            await self._pc.close()
        finally:
            self._outbound_track.stop()
            self._closed.set()

    async def teardown(self) -> VoiceWebRTCSessionResult:
        await self.stop()

        if self._bridge_task is not None:
            try:
                stats = await self._result
            except Exception as exc:  # pragma: no cover - garde-fou
                logger.exception("Pont voix en erreur", exc_info=exc)
                stats = VoiceBridgeStats(
                    duration_seconds=max(0.0, time.monotonic() - self._start_time),
                    inbound_audio_bytes=0,
                    outbound_audio_bytes=0,
                    transcripts=[],
                    error=exc,
                )
                return VoiceWebRTCSessionResult(stats=stats, error=exc)
            return VoiceWebRTCSessionResult(stats=stats, error=stats.error)

        # Aucun flux audio n'a été traité (offre annulée ou échec initial)
        fallback = VoiceBridgeStats(
            duration_seconds=max(0.0, time.monotonic() - self._start_time),
            inbound_audio_bytes=0,
            outbound_audio_bytes=0,
            transcripts=[],
            error=None,
        )
        return VoiceWebRTCSessionResult(stats=fallback, error=None)

    async def _run_bridge(self, track: MediaStreamTrack) -> None:
        session_result: VoiceWebRTCSessionResult | None = None

        async def _rtp_stream() -> AsyncIterator[RtpPacket]:
            sequence = 0
            timestamp = 0
            while True:
                try:
                    frame = await track.recv()
                except MediaStreamError:  # type: ignore[misc]
                    break
                pcm = self._frame_to_pcm(frame)
                if not pcm:
                    continue
                yield RtpPacket(
                    payload=pcm,
                    timestamp=timestamp,
                    sequence_number=sequence,
                    payload_type=0,
                )
                sequence = (sequence + 1) % 65536
                timestamp += len(pcm) // 2

        try:
            stats = await self._bridge.run(
                client_secret=self._client_secret,
                model=self._model,
                instructions=self._instructions,
                voice=self._voice,
                rtp_stream=_rtp_stream(),
                send_to_peer=self._outbound_track.send_pcm,
                api_base=self._api_base,
            )
            session_result = VoiceWebRTCSessionResult(stats=stats, error=stats.error)
            if not self._result.done():
                self._result.set_result(stats)
        except Exception as exc:  # pragma: no cover
            logger.exception("Échec du pont WebRTC voix", exc_info=exc)
            fallback = VoiceBridgeStats(
                duration_seconds=max(0.0, time.monotonic() - self._start_time),
                inbound_audio_bytes=0,
                outbound_audio_bytes=0,
                transcripts=[],
                error=exc,
            )
            session_result = VoiceWebRTCSessionResult(stats=fallback, error=exc)
            if not self._result.done():
                self._result.set_result(fallback)
        finally:
            try:
                track.stop()
            except Exception:  # pragma: no cover - suivant implémentation aiortc
                pass
            await self.stop()
            if self._on_complete is not None:
                try:
                    if session_result is None and self._result.done():
                        try:
                            stats = self._result.result()
                        except Exception:  # pragma: no cover
                            stats = None
                        if stats is not None:
                            session_result = VoiceWebRTCSessionResult(
                                stats=stats,
                                error=getattr(stats, "error", None),
                            )
                    self._on_complete(self.session_id, session_result)
                except Exception:  # pragma: no cover - éviter d'interrompre le flux
                    logger.exception("Callback de complétion WebRTC en erreur")

    def _frame_to_pcm(self, frame: Any) -> bytes:
        if AudioFrame is None:  # pragma: no cover - dépendance absente
            return b""
        try:
            array = frame.to_ndarray(format="s16", layout="mono")
        except Exception as exc:  # pragma: no cover - conversion audio défaillante
            logger.debug("Conversion frame->PCM impossible", exc_info=exc)
            return b""

        pcm_bytes = array.tobytes()
        sample_rate = (
            getattr(frame, "sample_rate", self._sample_rate) or self._sample_rate
        )
        if sample_rate != self._sample_rate:
            pcm_bytes, _ = audioop.ratecv(
                pcm_bytes,
                2,
                1,
                int(sample_rate),
                self._sample_rate,
                None,
            )
        return pcm_bytes


class VoiceWebRTCGateway:
    """Gestionnaire de sessions WebRTC vocale côté serveur."""

    def __init__(self, *, sample_rate: int = 24_000) -> None:
        self._sessions: dict[str, VoiceWebRTCSession] = {}
        self._completed: dict[str, VoiceWebRTCSessionResult] = {}
        self._lock = asyncio.Lock()
        self._sample_rate = sample_rate

    async def create_session(
        self,
        *,
        bridge: TelephonyVoiceBridge,
        client_secret: str,
        offer: RTCSessionDescription,
        model: str,
        instructions: str,
        voice: str | None,
        api_base: str | None = None,
    ) -> tuple[VoiceWebRTCSession, RTCSessionDescription]:
        if not isinstance(client_secret, str) or not client_secret.strip():
            raise VoiceWebRTCGatewayError(
                "Client secret invalide pour la session WebRTC voix"
            )

        session = VoiceWebRTCSession(
            bridge=bridge,
            client_secret=client_secret,
            model=model,
            instructions=instructions,
            voice=voice,
            api_base=api_base,
            sample_rate=self._sample_rate,
            on_complete=self._handle_completion,
        )

        answer = await session.accept_offer(offer)
        async with self._lock:
            self._sessions[session.session_id] = session
        return session, answer

    async def teardown(self, session_id: str) -> VoiceWebRTCSessionResult:
        async with self._lock:
            session = self._sessions.pop(session_id, None)
            completed = self._completed.pop(session_id, None)

        if session is not None:
            result = await session.teardown()
            async with self._lock:
                self._completed.pop(session_id, None)
            return result

        if completed is not None:
            return completed

        raise VoiceWebRTCGatewayError("Session WebRTC voix introuvable")

    def _handle_completion(
        self, session_id: str, result: VoiceWebRTCSessionResult | None
    ) -> None:
        if not session_id:
            return

        async def _finalize() -> None:
            async with self._lock:
                if result is not None:
                    self._completed[session_id] = result
                self._sessions.pop(session_id, None)

        asyncio.create_task(_finalize())


__all__ = [
    "VoiceWebRTCGateway",
    "VoiceWebRTCGatewayError",
    "VoiceWebRTCSessionResult",
]

