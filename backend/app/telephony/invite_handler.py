"""Gestion basique des ``INVITE`` SIP pour le pont téléphonie."""

from __future__ import annotations

import logging
import random
import time
from collections.abc import Iterable
from dataclasses import dataclass

logger = logging.getLogger("chatkit.telephony.invite")


@dataclass(frozen=True)
class SelectedCodec:
    """Informations sur le codec retenu pour la session RTP."""

    payload_type: int
    name: str
    clock_rate: int


_STATIC_PAYLOADS: dict[int, tuple[str, int]] = {
    0: ("pcmu", 8000),
    18: ("g729", 8000),
}


def _parse_payload_map(sdp_lines: Iterable[str]) -> dict[int, tuple[str, int]]:
    payload_map: dict[int, tuple[str, int]] = {}
    for line in sdp_lines:
        if not line.startswith("a=rtpmap:"):
            continue
        try:
            payload_part, encoding = line[len("a=rtpmap:") :].split(" ", 1)
            payload = int(payload_part)
            codec_name, clock_rate_text = encoding.split("/", 1)
            clock_rate = int(clock_rate_text.split(" ", 1)[0])
        except (ValueError, IndexError):
            logger.debug("Ligne rtpmap ignorée (mal formée) : %s", line)
            continue
        payload_map[payload] = (codec_name.lower(), clock_rate)
    return payload_map


def _select_codec(
    *,
    offered_payloads: Iterable[int],
    payload_map: dict[int, tuple[str, int]],
    preferred_codecs: Iterable[str],
) -> SelectedCodec | None:
    normalized = [name.lower() for name in preferred_codecs]
    for payload in offered_payloads:
        codec_info = payload_map.get(payload) or _STATIC_PAYLOADS.get(payload)
        if codec_info is None:
            continue
        codec_name, clock_rate = codec_info
        if codec_name.lower() in normalized:
            return SelectedCodec(payload, codec_name, clock_rate)
    return None


def _parse_audio_media_line(sdp_lines: Iterable[str]) -> tuple[int, list[int]] | None:
    for line in sdp_lines:
        if not line.startswith("m=audio"):
            continue
        parts = line.split()
        if len(parts) < 4:
            logger.debug("Ligne m=audio ignorée (mal formée) : %s", line)
            return None
        try:
            port = int(parts[1])
            payloads = [int(value) for value in parts[3:]]
        except ValueError:
            logger.debug("Ligne m=audio ignorée (payload non numérique) : %s", line)
            return None
        return port, payloads
    return None


def _build_sdp_answer(
    *,
    connection_address: str,
    media_port: int,
    codec: SelectedCodec,
) -> str:
    session_id = random.randint(1, 2**31 - 1)
    session_version = int(time.time())
    lines = [
        "v=0",
        f"o=- {session_id} {session_version} IN IP4 {connection_address}",
        "s=ChatKit Voice Session",
        f"c=IN IP4 {connection_address}",
        "t=0 0",
        f"m=audio {media_port} RTP/AVP {codec.payload_type}",
        f"a=rtpmap:{codec.payload_type} {codec.name.upper()}/{codec.clock_rate}",
        "a=sendrecv",
    ]
    return "\r\n".join(lines) + "\r\n"


class InviteHandlingError(RuntimeError):
    """Erreur levée lorsqu'un ``INVITE`` ne peut pas être accepté."""


async def handle_incoming_invite(
    dialog: _InviteDialog,
    request: _InviteRequest,
    *,
    media_host: str,
    media_port: int,
    preferred_codecs: Iterable[str] = ("pcmu", "g729"),
) -> None:
    """Répondre à un ``INVITE`` SIP en négociant une session RTP simple."""

    await dialog.reply(100, reason="Trying")

    try:
        payload_text = request.payload.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        logger.warning("SDP reçu illisible : %s", exc)
        await dialog.reply(400, reason="Bad Request")
        raise InviteHandlingError("SDP illisible") from exc

    sdp_lines = [line.strip() for line in payload_text.splitlines() if line.strip()]
    audio_media = _parse_audio_media_line(sdp_lines)
    if audio_media is None:
        logger.warning("INVITE sans média audio exploitable")
        await dialog.reply(603, reason="Decline")
        raise InviteHandlingError("Aucun média audio trouvé")

    offered_port, offered_payloads = audio_media
    logger.info(
        "INVITE reçu : port audio=%s, payloads=%s",
        offered_port,
        ",".join(str(p) for p in offered_payloads),
    )

    payload_map = _parse_payload_map(sdp_lines)
    codec = _select_codec(
        offered_payloads=offered_payloads,
        payload_map=payload_map,
        preferred_codecs=preferred_codecs,
    )

    if codec is None:
        logger.warning("Aucun codec commun trouvé pour l'INVITE : %s", offered_payloads)
        await dialog.reply(603, reason="Decline")
        raise InviteHandlingError("Aucun codec compatible")

    await dialog.reply(180, reason="Ringing")

    sdp_answer = _build_sdp_answer(
        connection_address=media_host,
        media_port=media_port,
        codec=codec,
    )

    logger.info(
        "Codec sélectionné : payload=%s (%s/%s Hz)",
        codec.payload_type,
        codec.name,
        codec.clock_rate,
    )

    await dialog.reply(
        200,
        reason="OK",
        headers={"Content-Type": "application/sdp"},
        payload=sdp_answer.encode("utf-8"),
    )


class _InviteDialog:
    async def reply(  # pragma: no cover - protocole
        self,
        status_code: int,
        *,
        reason: str,
        headers=None,
        payload=None,
    ) -> None:
        raise NotImplementedError


class _InviteRequest:
    payload: bytes  # pragma: no cover - protocole

