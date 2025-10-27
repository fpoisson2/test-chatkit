"""Serveur RTP UDP pour le pont téléphonie."""

from __future__ import annotations

import asyncio
import audioop
import logging
import struct
import time
from collections.abc import AsyncIterator
from dataclasses import dataclass
from typing import Any

from .voice_bridge import RtpPacket

logger = logging.getLogger("chatkit.telephony.rtp")


@dataclass
class RtpServerConfig:
    """Configuration d'un serveur RTP."""

    local_host: str
    local_port: int
    remote_host: str | None = None
    remote_port: int | None = None
    payload_type: int = 0  # PCMU par défaut
    output_codec: str = "pcmu"
    ssrc: int | None = None


class RtpServer:
    """Serveur UDP/RTP pour gérer les flux audio SIP."""

    def __init__(self, config: RtpServerConfig) -> None:
        self._config = config
        self._transport: asyncio.DatagramTransport | None = None
        self._protocol: _RtpProtocol | None = None
        self._running = False
        self._packet_queue: asyncio.Queue[RtpPacket | None] = asyncio.Queue()
        self._sequence_number = 0
        self._timestamp = 0
        self._ssrc = config.ssrc or int(time.time() * 1000) & 0xFFFFFFFF
        self._remote_addr: tuple[str, int] | None = None
        if config.remote_host and config.remote_port:
            self._remote_addr = (config.remote_host, config.remote_port)

    async def start(self) -> None:
        """Démarre le serveur UDP RTP."""
        if self._running:
            logger.warning("Serveur RTP déjà démarré")
            return

        loop = asyncio.get_running_loop()
        self._protocol = _RtpProtocol(
            packet_queue=self._packet_queue,
            on_remote_discovered=self._on_remote_discovered,
        )

        try:
            transport, _ = await loop.create_datagram_endpoint(
                lambda: self._protocol,
                local_addr=(self._config.local_host, self._config.local_port),
            )
            self._transport = transport  # type: ignore[assignment]
            self._running = True

            # Récupère le port réellement assigné si c'était 0
            sock = self._transport.get_extra_info("socket")
            if sock:
                actual_port = sock.getsockname()[1]
                if actual_port != self._config.local_port:
                    logger.info(
                        "Serveur RTP démarré sur %s:%d (port assigné par l'OS)",
                        self._config.local_host,
                        actual_port,
                    )
                    self._config.local_port = actual_port
                else:
                    logger.info(
                        "Serveur RTP démarré sur %s:%d",
                        self._config.local_host,
                        self._config.local_port,
                    )
        except Exception as exc:
            logger.exception(
                "Impossible de démarrer le serveur RTP sur %s:%d",
                self._config.local_host,
                self._config.local_port,
                exc_info=exc,
            )
            raise

    async def stop(self) -> None:
        """Arrête le serveur RTP."""
        if not self._running:
            return

        self._running = False
        # Signal de fin du stream
        await self._packet_queue.put(None)

        if self._transport:
            self._transport.close()
            self._transport = None

        logger.info("Serveur RTP arrêté")

    def _on_remote_discovered(self, addr: tuple[str, int]) -> None:
        """Callback appelé quand l'adresse distante est découverte."""
        if self._remote_addr is None:
            self._remote_addr = addr
            logger.info(
                "Adresse distante RTP découverte : %s:%d", addr[0], addr[1]
            )

    async def send_audio(self, pcm_data: bytes) -> None:
        """Envoie de l'audio PCM16 au peer SIP.

        Args:
            pcm_data: Audio au format PCM16 (16-bit linear, 16kHz ou 8kHz)
        """
        if not self._running or not self._transport or not self._remote_addr:
            return

        # Convertir PCM16 en codec de sortie (PCMU par défaut)
        encoded_payload = self._encode_audio(pcm_data)
        if not encoded_payload:
            return

        # Construire le paquet RTP
        rtp_packet = self._build_rtp_packet(encoded_payload)

        try:
            self._transport.sendto(rtp_packet, self._remote_addr)
        except Exception as exc:
            logger.debug("Erreur lors de l'envoi RTP : %s", exc)

    def _encode_audio(self, pcm_data: bytes) -> bytes:
        """Encode le PCM16 dans le codec de sortie."""
        if not pcm_data:
            return b""

        # Le codec de sortie est configuré dans la config
        codec = self._config.output_codec.lower()

        # Conversion du taux d'échantillonnage si nécessaire
        # OpenAI Realtime GA envoie du PCM16 à 24kHz, mais PCMU attend du 8kHz
        if codec in ("pcmu", "pcma"):
            # Convertir de 24kHz à 8kHz
            try:
                pcm_8k, _ = audioop.ratecv(pcm_data, 2, 1, 24_000, 8_000, None)
            except Exception as exc:
                logger.debug("Erreur lors de la conversion de taux : %s", exc)
                return b""

            # Encoder en μ-law ou A-law
            try:
                if codec == "pcmu":
                    return audioop.lin2ulaw(pcm_8k, 2)
                else:  # pcma
                    return audioop.lin2alaw(pcm_8k, 2)
            except Exception as exc:
                logger.debug("Erreur lors de l'encodage audio : %s", exc)
                return b""
        else:
            # Pour d'autres codecs, retourner le PCM tel quel
            return pcm_data

    def _build_rtp_packet(self, payload: bytes) -> bytes:
        """Construit un paquet RTP avec l'en-tête standard."""
        # En-tête RTP (12 octets)
        # Version=2, Padding=0, Extension=0, CSRC count=0
        # Marker=0, Payload Type=0 (PCMU)
        version_flags = 0x80  # Version 2
        marker_pt = self._config.payload_type & 0x7F

        # Incrémenter les compteurs
        self._sequence_number = (self._sequence_number + 1) & 0xFFFF

        # Le timestamp s'incrémente selon le nombre d'échantillons
        # Pour PCMU à 8kHz, 20ms = 160 échantillons
        samples_per_packet = len(payload)  # 1 octet = 1 échantillon en PCMU
        self._timestamp = (self._timestamp + samples_per_packet) & 0xFFFFFFFF

        # Construire l'en-tête
        header = struct.pack(
            "!BBHII",
            version_flags,
            marker_pt,
            self._sequence_number,
            self._timestamp,
            self._ssrc,
        )

        return header + payload

    async def packet_stream(self) -> AsyncIterator[RtpPacket]:
        """Itérateur asynchrone qui yield les paquets RTP reçus."""
        while self._running:
            packet = await self._packet_queue.get()
            if packet is None:  # Signal d'arrêt
                break
            yield packet

    @property
    def local_port(self) -> int:
        """Port local sur lequel le serveur écoute."""
        return self._config.local_port


class _RtpProtocol(asyncio.DatagramProtocol):
    """Protocole pour recevoir les paquets RTP UDP."""

    def __init__(
        self,
        packet_queue: asyncio.Queue[RtpPacket | None],
        on_remote_discovered: Any,
    ) -> None:
        self._packet_queue = packet_queue
        self._on_remote_discovered = on_remote_discovered
        self._remote_addr: tuple[str, int] | None = None

    def datagram_received(self, data: bytes, addr: tuple[str, int]) -> None:
        """Callback appelé quand un datagramme UDP est reçu."""
        # Mémoriser l'adresse distante au premier paquet
        if self._remote_addr is None:
            self._remote_addr = addr
            if callable(self._on_remote_discovered):
                self._on_remote_discovered(addr)

        # Parser le paquet RTP
        packet = self._parse_rtp_packet(data)
        if packet:
            # Mettre dans la queue de manière non-bloquante
            try:
                self._packet_queue.put_nowait(packet)
            except asyncio.QueueFull:
                logger.debug("Queue RTP pleine, paquet ignoré")

    def error_received(self, exc: Exception) -> None:
        """Callback appelé en cas d'erreur."""
        logger.debug("Erreur UDP RTP : %s", exc)

    @staticmethod
    def _parse_rtp_packet(data: bytes) -> RtpPacket | None:
        """Parse un paquet RTP brut."""
        if len(data) < 12:
            # Paquet trop court pour contenir un en-tête RTP
            return None

        try:
            # Parser l'en-tête RTP (12 octets minimum)
            version_flags, marker_pt, seq_num, timestamp, ssrc = struct.unpack(
                "!BBHII", data[:12]
            )

            version = (version_flags >> 6) & 0x03
            if version != 2:
                logger.debug("Paquet RTP avec version invalide : %d", version)
                return None

            padding = bool(version_flags & 0x20)
            extension = bool(version_flags & 0x10)
            csrc_count = version_flags & 0x0F

            marker = bool(marker_pt & 0x80)
            payload_type = marker_pt & 0x7F

            # Calculer l'offset du payload
            header_length = 12 + (csrc_count * 4)

            if extension:
                # Si extension présente, lire la longueur
                if len(data) < header_length + 4:
                    return None
                ext_length = struct.unpack("!H", data[header_length + 2 : header_length + 4])[0]
                header_length += 4 + (ext_length * 4)

            if len(data) < header_length:
                return None

            payload = data[header_length:]

            # Gérer le padding si présent
            if padding and payload:
                padding_length = payload[-1]
                if padding_length > 0 and padding_length <= len(payload):
                    payload = payload[:-padding_length]

            return RtpPacket(
                payload=payload,
                timestamp=timestamp,
                sequence_number=seq_num,
                payload_type=payload_type,
                marker=marker,
            )
        except Exception as exc:
            logger.debug("Erreur lors du parsing RTP : %s", exc)
            return None


__all__ = ["RtpServer", "RtpServerConfig"]
