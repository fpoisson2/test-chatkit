"""Gestion basique des ``INVITE`` SIP pour le pont téléphonie."""

from __future__ import annotations

import inspect
import logging
import random
import time
from collections.abc import Iterable, Mapping
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

    call_id = _extract_header(request, "Call-ID")
    from_header = _extract_header(request, "From")
    to_header = _extract_header(request, "To")

    logger.info(
        "INVITE reçu (Call-ID=%s, From=%s, To=%s)",
        call_id or "inconnu",
        from_header or "?",
        to_header or "?",
    )

    await send_sip_reply(dialog, 100, reason="Trying", call_id=call_id)

    payload = request.payload
    if isinstance(payload, bytes):
        try:
            payload_text = payload.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            logger.warning(
                "SDP reçu illisible (Call-ID=%s) : %s",
                call_id or "inconnu",
                exc,
            )
            await send_sip_reply(dialog, 400, reason="Bad Request", call_id=call_id)
            raise InviteHandlingError("SDP illisible") from exc
    elif isinstance(payload, str):
        payload_text = payload
    else:
        payload_text = str(payload)

    logger.debug(
        "SDP reçu (Call-ID=%s, %d octets):\n%s",
        call_id or "inconnu",
        len(payload) if isinstance(payload, bytes | str) else len(payload_text),
        payload_text,
    )

    sdp_lines = [line.strip() for line in payload_text.splitlines() if line.strip()]
    audio_media = _parse_audio_media_line(sdp_lines)
    if audio_media is None:
        logger.warning(
            "INVITE sans média audio exploitable (Call-ID=%s)", call_id or "inconnu"
        )
        await send_sip_reply(dialog, 603, reason="Decline", call_id=call_id)
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
        logger.warning(
            "Aucun codec commun trouvé pour l'INVITE (Call-ID=%s) : %s",
            call_id or "inconnu",
            offered_payloads,
        )
        await send_sip_reply(dialog, 603, reason="Decline", call_id=call_id)
        raise InviteHandlingError("Aucun codec compatible")

    await send_sip_reply(dialog, 180, reason="Ringing", call_id=call_id)

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

    logger.debug(
        "SDP de réponse généré (Call-ID=%s) :\n%s",
        call_id or "inconnu",
        sdp_answer,
    )

    await send_sip_reply(
        dialog,
        200,
        reason="OK",
        headers={"Content-Type": "application/sdp"},
        payload=sdp_answer.encode("utf-8"),
        call_id=call_id,
    )


def _extract_header(request: _InviteRequest, name: str) -> str | None:
    headers = getattr(request, "headers", None)
    if not isinstance(headers, Mapping):
        return None

    lower_name = name.lower()
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == lower_name:
            if isinstance(value, list | tuple) and value:
                return str(value[0])
            return str(value)
    return None


async def send_sip_reply(
    dialog: _InviteDialog,
    status_code: int,
    *,
    reason: str,
    headers: dict[str, str] | None = None,
    payload: bytes | None = None,
    call_id: str | None = None,
) -> None:
    logger.info(
        "Envoi réponse SIP %s %s (Call-ID=%s)",
        status_code,
        reason,
        call_id or "inconnu",
    )
    kwargs: dict[str, object] = {"reason": reason}
    if headers is not None:
        kwargs["headers"] = headers
    if payload is not None:
        kwargs["payload"] = payload
    reply_method = getattr(dialog, "reply", None)
    if callable(reply_method):
        result = reply_method(status_code, **kwargs)
        if inspect.isawaitable(result):
            await result
        return

    send_reply = getattr(dialog, "send_reply", None)
    if callable(send_reply):
        send_kwargs: dict[str, object] = {}
        if headers is not None:
            send_kwargs["headers"] = headers
        if payload is not None:
            send_kwargs["payload"] = payload
        send_reply(status_code, reason, **send_kwargs)
        return

    raise AttributeError("Le dialogue SIP ne supporte ni reply() ni send_reply().")


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

