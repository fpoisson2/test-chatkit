from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from backend.app.telephony.invite_handler import (  # noqa: E402
    InviteHandlingError,
    handle_incoming_invite,
    send_sip_reply,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class DummyDialog:
    def __init__(self) -> None:
        self.replies: list[tuple[int, dict[str, object]]] = []

    async def reply(self, status_code: int, **kwargs) -> None:
        # Simuler le comportement async d'un dialogue aiosip
        await asyncio.sleep(0)
        self.replies.append((status_code, kwargs))


class SyncDialog:
    def __init__(self) -> None:
        self.replies: list[tuple[int, str, dict[str, str] | None, bytes | None]] = []

    def send_reply(
        self,
        status_code: int,
        status_message: str,
        *,
        headers: dict[str, str] | None = None,
        payload: bytes | None = None,
        **_: object,
    ) -> None:
        self.replies.append((status_code, status_message, headers, payload))


def _make_invite(sdp: str) -> SimpleNamespace:
    return SimpleNamespace(payload=sdp.encode("utf-8"))


@pytest.mark.anyio
async def test_handle_invite_accepts_supported_codec() -> None:
    dialog = DummyDialog()
    invite = _make_invite(
        "\r\n".join(
            [
                "v=0",
                "o=- 12345 67890 IN IP4 198.51.100.10",
                "s=-",
                "c=IN IP4 198.51.100.10",
                "t=0 0",
                "m=audio 49170 RTP/AVP 0 18",
                "a=rtpmap:0 PCMU/8000",
                "a=rtpmap:18 G729/8000",
            ]
        )
    )

    await handle_incoming_invite(
        dialog,
        invite,
        media_host="203.0.113.5",
        media_port=5004,
        preferred_codecs=("pcmu", "g729"),
    )

    statuses = [status for status, _ in dialog.replies]
    assert statuses == [100, 180, 200]

    final_reply = dialog.replies[-1]
    headers = final_reply[1]["headers"]
    assert headers == {"Content-Type": "application/sdp"}
    payload = final_reply[1]["payload"].decode("utf-8")
    assert "m=audio 5004 RTP/AVP 0" in payload
    assert "a=rtpmap:0 PCMU/8000" in payload


@pytest.mark.anyio
async def test_handle_invite_declines_without_codec() -> None:
    dialog = DummyDialog()
    invite = _make_invite(
        "\r\n".join(
            [
                "v=0",
                "o=- 1 1 IN IP4 198.51.100.10",
                "s=-",
                "c=IN IP4 198.51.100.10",
                "t=0 0",
                "m=audio 49170 RTP/AVP 101",
                "a=rtpmap:101 opus/48000/2",
            ]
        )
    )

    with pytest.raises(InviteHandlingError):
        await handle_incoming_invite(
            dialog,
            invite,
            media_host="203.0.113.5",
            media_port=6000,
            preferred_codecs=("pcmu", "g729"),
        )

    statuses = [status for status, _ in dialog.replies]
    assert statuses == [100, 603]


@pytest.mark.anyio
async def test_send_sip_reply_falls_back_to_sync_send_reply() -> None:
    dialog = SyncDialog()

    await send_sip_reply(
        dialog,
        486,
        reason="Busy Here",
        headers={"X-Test": "1"},
        payload=b"",
        call_id="abc",
    )

    assert dialog.replies == [(486, "Busy Here", {"X-Test": "1"}, b"")]

