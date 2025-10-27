"""Gestion basique d'un flux RTP sur UDP pour la téléphonie SIP."""

from __future__ import annotations

import asyncio
import audioop
import logging
import random
import struct
from collections.abc import AsyncIterator
from typing import Any

from .voice_bridge import RtpPacket

logger = logging.getLogger("chatkit.telephony.rtp")


class _RtpReceiver(asyncio.DatagramProtocol):
    """Protocol UDP minimal convertissant les datagrammes RTP en :class:`RtpPacket`."""

    def __init__(
        self,
        *,
        expected_host: str | None = None,
        expected_port: int | None = None,
        expected_payload: int | None = None,
    ) -> None:
        self._queue: asyncio.Queue[RtpPacket | None] = asyncio.Queue(maxsize=512)
        self._expected_host = expected_host
        self._expected_port = expected_port
        self._expected_payload = expected_payload
        self._closed = asyncio.Event()

    def close(self) -> None:
        if not self._closed.is_set():
            self._closed.set()
            try:
                self._queue.put_nowait(None)
            except asyncio.QueueFull:  # pragma: no cover - taille faible
                pass

    async def iter_packets(self) -> AsyncIterator[RtpPacket]:
        while True:
            packet = await self._queue.get()
            if packet is None:
                break
            yield packet

    # asyncio.DatagramProtocol API -------------------------------------------------

    def datagram_received(self, data: bytes, addr: Any) -> None:  # type: ignore[override]
        host: str | None = None
        port: int | None = None
        if isinstance(addr, tuple) and len(addr) >= 2:
            host = str(addr[0])
            try:
                port = int(addr[1])
            except Exception:  # pragma: no cover - garde-fou
                port = None

        if self._expected_host and host and host != self._expected_host:
            logger.debug("Paquet RTP ignoré (hôte inattendu %s)", host)
            return
        if self._expected_port and port and port != self._expected_port:
            # Certains PBX enverront les paquets depuis le port RTP pair ou impair ;
            # acceptons la première valeur observée.
            if self._expected_port + 1 == port and self._expected_payload is not None:
                # flux RTCP probable, ignoré.
                return
            logger.debug("Paquet RTP ignoré (port %s inattendu)", port)
            return

        packet = self._parse_packet(data)
        if packet is None:
            return
        if (
            self._expected_payload is not None
            and packet.payload_type != self._expected_payload
        ):
            logger.debug(
                "Paquet RTP ignoré (payload=%s attendu=%s)",
                packet.payload_type,
                self._expected_payload,
            )
            return

        try:
            self._queue.put_nowait(packet)
        except asyncio.QueueFull:  # pragma: no cover - taille faible
            logger.debug("File RTP saturée, paquet abandonné")

    def connection_lost(self, exc: Exception | None) -> None:  # type: ignore[override]
        if exc:
            logger.debug("Connexion RTP perdue : %s", exc)
        self.close()

    # ---------------------------------------------------------------------------

    def _parse_packet(self, data: bytes) -> RtpPacket | None:
        if len(data) < 12:
            logger.debug("Datagramme RTP trop court (%d octets)", len(data))
            return None

        first_byte = data[0]
        version = first_byte >> 6
        if version != 2:
            logger.debug("Datagramme RTP version %s ignoré", version)
            return None

        padding = bool(first_byte & 0x20)
        extension = bool(first_byte & 0x10)
        csrc_count = first_byte & 0x0F
        marker = bool(data[1] & 0x80)
        payload_type = data[1] & 0x7F
        sequence_number = struct.unpack_from("!H", data, 2)[0]
        timestamp = struct.unpack_from("!I", data, 4)[0]

        offset = 12 + csrc_count * 4
        if len(data) < offset:
            return None

        if extension:
            if len(data) < offset + 4:
                logger.debug("Extension RTP mal formée")
                return None
            extension_length = struct.unpack_from("!H", data, offset + 2)[0]
            offset += 4 + extension_length * 4

        if len(data) < offset:
            return None

        payload = data[offset:]
        if padding and payload:
            pad_length = payload[-1]
            if pad_length <= len(payload):
                payload = payload[:-pad_length]

        return RtpPacket(
            payload=payload,
            timestamp=timestamp,
            sequence_number=sequence_number,
            payload_type=payload_type,
            marker=marker,
        )


class RtpUdpEndpoint:
    """Crée une extrémité RTP simple pour un appel SIP."""

    def __init__(
        self,
        *,
        local_host: str,
        local_port: int,
        remote_host: str,
        remote_port: int,
        payload_type: int,
        codec: str,
        clock_rate: int,
    ) -> None:
        self._local_host = local_host or "0.0.0.0"
        self._local_port = int(local_port)
        self._remote_host = remote_host
        self._remote_port = int(remote_port)
        self._payload_type = int(payload_type)
        self._codec = codec.lower()
        self._clock_rate = int(clock_rate) if clock_rate else 8_000

        self._transport: asyncio.DatagramTransport | None = None
        self._receiver: _RtpReceiver | None = None
        self._start_lock = asyncio.Lock()

        self._sequence_number = random.randint(0, 2**16 - 1)
        self._timestamp = random.randint(0, 2**32 - 1)
        self._ssrc = random.randint(1, 2**32 - 1)
        self._resample_state: tuple[Any, ...] | None = None
        self._frame_samples = max(1, self._clock_rate // 50)

    async def stream(self) -> AsyncIterator[RtpPacket]:
        await self._ensure_started()
        if self._receiver is None:  # pragma: no cover - garde-fou
            return
        async for packet in self._receiver.iter_packets():
            yield packet

    async def send(self, pcm: bytes) -> None:
        if not pcm:
            return
        await self._ensure_started()
        if self._transport is None:
            return

        if self._codec not in {"pcmu", "pcma"}:
            logger.debug("Codec %s non pris en charge pour l'émission", self._codec)
            return

        target_rate = 8_000 if self._codec in {"pcmu", "pcma"} else self._clock_rate
        if target_rate != 16_000:
            pcm8k, self._resample_state = audioop.ratecv(
                pcm, 2, 1, 16_000, target_rate, self._resample_state
            )
        else:  # pragma: no cover - garde-fou
            pcm8k = pcm

        if not pcm8k:
            return

        if self._codec == "pcmu":
            encoded = audioop.lin2ulaw(pcm8k, 2)
        else:  # pcma
            encoded = audioop.lin2alaw(pcm8k, 2)

        marker = True
        step = max(1, self._frame_samples)
        for start in range(0, len(encoded), step):
            payload = encoded[start : start + step]
            if not payload:
                continue
            header = self._build_header(marker)
            marker = False
            packet = header + payload
            try:
                self._transport.sendto(packet, (self._remote_host, self._remote_port))
            except Exception:  # pragma: no cover - dépend réseau
                logger.debug("Émission RTP échouée", exc_info=True)
                break
            self._sequence_number = (self._sequence_number + 1) % 2**16
            self._timestamp = (self._timestamp + len(payload)) % 2**32

    async def close(self) -> None:
        async with self._start_lock:
            if self._receiver is not None:
                self._receiver.close()
            if self._transport is not None:
                self._transport.close()
            self._receiver = None
            self._transport = None

    # ------------------------------------------------------------------

    async def _ensure_started(self) -> None:
        if self._transport is not None:
            return
        async with self._start_lock:
            if self._transport is not None:
                return
            loop = asyncio.get_running_loop()
            receiver = _RtpReceiver(
                expected_host=self._remote_host,
                expected_port=self._remote_port,
                expected_payload=self._payload_type,
            )
            try:
                transport, _ = await loop.create_datagram_endpoint(
                    lambda: receiver,
                    local_addr=(self._local_host, self._local_port),
                    allow_broadcast=False,
                    reuse_address=True,
                )
            except OSError as exc:
                logger.error(
                    "Impossible d'ouvrir le port RTP %s:%s : %s",
                    self._local_host,
                    self._local_port,
                    exc,
                )
                raise
            self._transport = transport
            self._receiver = receiver

    def _build_header(self, marker: bool) -> bytes:
        v_p_x_cc = 0x80  # Version 2, pas de padding/extension/CSRC
        m_pt = (0x80 if marker else 0x00) | (self._payload_type & 0x7F)
        return struct.pack(
            "!BBHII",
            v_p_x_cc,
            m_pt,
            self._sequence_number,
            self._timestamp,
            self._ssrc,
        )


__all__ = ["RtpUdpEndpoint"]

