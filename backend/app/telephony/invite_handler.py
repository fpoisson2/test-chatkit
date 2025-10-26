"""Gestion basique des ``INVITE`` SIP pour le pont téléphonie."""

from __future__ import annotations

import inspect
import logging
import random
import re
import time
from collections.abc import Iterable, Mapping
from dataclasses import dataclass

logger = logging.getLogger("chatkit.telephony.invite")


def _log_call_event(
    level: int,
    call_id: str | None,
    message: str,
    **context: object,
) -> None:
    """Consistently log SIP call events with contextual key/value pairs."""

    if not logger.isEnabledFor(level):
        return

    formatted_context = " ".join(
        f"{key}={value}"
        for key, value in context.items()
        if value not in (None, "")
    )
    if formatted_context:
        logger.log(
            level,
            "[Call-ID=%s] %s | %s",
            call_id or "inconnu",
            message,
            formatted_context,
        )
    else:
        logger.log(level, "[Call-ID=%s] %s", call_id or "inconnu", message)


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


def _parse_connection_address(sdp_lines: Iterable[str]) -> str | None:
    """Extraire l'adresse de connexion RTP depuis le SDP."""

    session_connection: str | None = None
    audio_connection: str | None = None
    in_audio_section = False
    for line in sdp_lines:
        if line.startswith("m="):
            in_audio_section = line.startswith("m=audio")
            continue
        if not line.startswith("c="):
            continue

        parts = line[2:].strip().split()
        if len(parts) < 3:
            logger.debug("Ligne c= ignorée (mal formée) : %s", line)
            continue
        address = parts[2]
        if in_audio_section and audio_connection is None:
            audio_connection = address
        elif session_connection is None:
            session_connection = address

    return audio_connection or session_connection


def _describe_offered_codecs(
    offered_payloads: Iterable[int],
    payload_map: Mapping[int, tuple[str, int]],
) -> str:
    """Fournir une représentation textuelle des codecs proposés."""

    descriptions: list[str] = []
    for payload in offered_payloads:
        codec_info = payload_map.get(payload) or _STATIC_PAYLOADS.get(payload)
        if codec_info is None:
            descriptions.append(str(payload))
            continue
        codec_name, clock_rate = codec_info
        descriptions.append(f"{payload}:{codec_name}/{clock_rate}")
    return ",".join(descriptions)


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
    contact_uri: str | None = None,
) -> None:
    """Répondre à un ``INVITE`` SIP en négociant une session RTP simple."""

    via_header = _extract_header(request, "Via")
    call_id = _extract_header(request, "Call-ID")
    from_header = _extract_header(request, "From")
    to_header = _extract_header(request, "To")

    _log_call_event(
        logging.INFO,
        call_id,
        "INVITE reçu",
        caller=from_header or "?",
        callee=to_header or "?",
        via=via_header,
    )

    await send_sip_reply(
        dialog,
        100,
        reason="Trying",
        call_id=call_id,
        contact_uri=contact_uri,
        via_header=via_header,
    )

    payload = request.payload
    payload_length: int
    if isinstance(payload, bytes):
        try:
            payload_text = payload.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            _log_call_event(
                logging.WARNING,
                call_id,
                "SDP illisible",
                erreur=exc,
            )
            await send_sip_reply(
                dialog,
                400,
                reason="Bad Request",
                call_id=call_id,
                contact_uri=contact_uri,
                via_header=via_header,
            )
            raise InviteHandlingError("SDP illisible") from exc
        payload_length = len(payload)
    elif isinstance(payload, str):
        payload_text = payload
        payload_length = len(payload)
    else:
        payload_text = str(payload)
        payload_length = len(payload_text)

    normalized_payload_text = (
        payload_text.replace("\r\n", "\n").replace("\r", "\n")
    )

    if "\n" not in normalized_payload_text:
        compact_payload = normalized_payload_text.strip()
        normalized_payload_text = re.sub(
            r"(?<!^)(?=[A-Za-z][-A-Za-z]*=)",
            "\n",
            compact_payload,
        )

    logger.debug(
        "[Call-ID=%s] SDP reçu (%d octets):\n%s",
        call_id or "inconnu",
        payload_length,
        normalized_payload_text,
    )

    sdp_lines = [
        line.strip() for line in normalized_payload_text.splitlines() if line.strip()
    ]
    payload_map = _parse_payload_map(sdp_lines)
    audio_media = _parse_audio_media_line(sdp_lines)
    if audio_media is None:
        _log_call_event(
            logging.WARNING,
            call_id,
            "INVITE sans média audio exploitable",
        )
        await send_sip_reply(
            dialog,
            603,
            reason="Decline",
            call_id=call_id,
            contact_uri=contact_uri,
            via_header=via_header,
        )
        raise InviteHandlingError("Aucun média audio trouvé")

    offered_port, offered_payloads = audio_media
    connection_address = _parse_connection_address(sdp_lines)
    _log_call_event(
        logging.INFO,
        call_id,
        "Offre RTP détectée",
        rtp_host=connection_address or "?",
        rtp_port=offered_port,
        payloads=_describe_offered_codecs(offered_payloads, payload_map),
    )

    codec = _select_codec(
        offered_payloads=offered_payloads,
        payload_map=payload_map,
        preferred_codecs=preferred_codecs,
    )

    if codec is None:
        _log_call_event(
            logging.WARNING,
            call_id,
            "Aucun codec compatible",
            payloads=",".join(str(p) for p in offered_payloads),
        )
        await send_sip_reply(
            dialog,
            603,
            reason="Decline",
            call_id=call_id,
            contact_uri=contact_uri,
            via_header=via_header,
        )
        raise InviteHandlingError("Aucun codec compatible")

    await send_sip_reply(
        dialog,
        180,
        reason="Ringing",
        call_id=call_id,
        contact_uri=contact_uri,
        via_header=via_header,
    )

    sdp_answer = _build_sdp_answer(
        connection_address=media_host,
        media_port=media_port,
        codec=codec,
    )

    _log_call_event(
        logging.INFO,
        call_id,
        "Codec sélectionné",
        payload_type=codec.payload_type,
        codec=codec.name,
        clock_rate=codec.clock_rate,
        local_host=media_host,
        local_port=media_port,
        remote_host=connection_address or "?",
        remote_port=offered_port,
    )

    logger.debug(
        "[Call-ID=%s] SDP de réponse généré:\n%s",
        call_id or "inconnu",
        sdp_answer,
    )

    await send_sip_reply(
        dialog,
        200,
        reason="OK",
        headers={"Content-Type": "application/sdp"},
        payload=sdp_answer,
        call_id=call_id,
        contact_uri=contact_uri,
        via_header=via_header,
    )


def _extract_header(request: _InviteRequest, name: str) -> str | None:
    headers = getattr(request, "headers", None)
    if not isinstance(headers, Mapping):
        return None

    lower_name = name.lower()
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == lower_name:
            if isinstance(value, list) and value:
                return str(value[0])
            if isinstance(value, tuple) and value:
                return str(value[0])
            return str(value)
    return None


async def send_sip_reply(
    dialog: _InviteDialog,
    status_code: int,
    *,
    reason: str,
    headers: dict[str, str] | None = None,
    payload: bytes | str | None = None,
    call_id: str | None = None,
    contact_uri: str | None = None,
    via_header: str | None = None,
) -> None:
    if status_code < 200:
        log_level = logging.DEBUG
    elif status_code >= 400:
        log_level = logging.WARNING
    else:
        log_level = logging.INFO

    _log_call_event(
        log_level,
        call_id,
        "Réponse envoyée",
        status=f"{status_code} {reason}",
        via=via_header,
        contact=contact_uri,
    )
    merged_headers: dict[str, str] | None = None
    if headers:
        merged_headers = dict(headers)
    if contact_uri and (
        merged_headers is None
        or not any(key.lower() == "contact" for key in merged_headers)
    ):
        if merged_headers is None:
            merged_headers = {"Contact": contact_uri}
        else:
            merged_headers.setdefault("Contact", contact_uri)

    if via_header and (
        merged_headers is None
        or not any(key.lower() == "via" for key in merged_headers)
    ):
        if merged_headers is None:
            merged_headers = {"Via": via_header}
        else:
            merged_headers.setdefault("Via", via_header)

    kwargs: dict[str, object] = {"reason": reason}
    if merged_headers is not None:
        kwargs["headers"] = merged_headers
    normalized_payload: str | bytes | None = payload
    if isinstance(payload, bytes):
        try:
            normalized_payload = payload.decode("utf-8")
        except UnicodeDecodeError:
            _log_call_event(
                logging.WARNING,
                call_id,
                "Charge utile non UTF-8",
            )
            normalized_payload = payload.decode("utf-8", errors="replace")

    if normalized_payload is not None:
        kwargs["payload"] = normalized_payload
    reply_method = getattr(dialog, "reply", None)
    if callable(reply_method):
        result = reply_method(status_code, **kwargs)
        if inspect.isawaitable(result):
            await result
        return

    send_reply = getattr(dialog, "send_reply", None)
    if callable(send_reply):
        send_kwargs: dict[str, object] = {}
        if merged_headers is not None:
            send_kwargs["headers"] = merged_headers
        if normalized_payload is not None:
            send_kwargs["payload"] = normalized_payload
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

