import asyncio
import audioop
import base64
import json
import os
import struct
import sys
import types
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

CHATKIT_DIR = ROOT_DIR / "chatkit-python"
if str(CHATKIT_DIR) not in sys.path:
    sys.path.insert(0, str(CHATKIT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

if "fastapi" not in sys.modules:
    fastapi_pkg = types.ModuleType("fastapi")

    class _StubFastAPI:
        def __init__(self, *args: Any, **kwargs: Any) -> None:
            return

        def add_middleware(self, *args: Any, **kwargs: Any) -> None:
            return

    fastapi_pkg.FastAPI = _StubFastAPI  # type: ignore[attr-defined]
    sys.modules["fastapi"] = fastapi_pkg

    middleware_pkg = types.ModuleType("fastapi.middleware")
    cors_pkg = types.ModuleType("fastapi.middleware.cors")

    class _StubCORSMiddleware:
        ...

    cors_pkg.CORSMiddleware = _StubCORSMiddleware  # type: ignore[attr-defined]
    middleware_pkg.cors = cors_pkg  # type: ignore[attr-defined]
    fastapi_pkg.middleware = middleware_pkg  # type: ignore[attr-defined]
    sys.modules["fastapi.middleware"] = middleware_pkg
    sys.modules["fastapi.middleware.cors"] = cors_pkg

if "dotenv" not in sys.modules:
    dotenv_pkg = types.ModuleType("dotenv")

    def _stub_load_dotenv(*args: Any, **kwargs: Any) -> None:
        return

    dotenv_pkg.load_dotenv = _stub_load_dotenv  # type: ignore[attr-defined]
    sys.modules["dotenv"] = dotenv_pkg

if "backend" not in sys.modules:
    backend_pkg = types.ModuleType("backend")
    backend_pkg.__path__ = [str(ROOT_DIR / "backend")]
    sys.modules["backend"] = backend_pkg
else:
    backend_pkg = sys.modules["backend"]

if "backend.app" not in sys.modules:
    backend_app_pkg = types.ModuleType("backend.app")
    backend_app_pkg.__path__ = [str(ROOT_DIR / "backend" / "app")]
    sys.modules["backend.app"] = backend_app_pkg
    backend_pkg.app = backend_app_pkg  # type: ignore[attr-defined]
else:
    backend_app_pkg = sys.modules["backend.app"]

if "backend.app.telephony" not in sys.modules:
    telephony_pkg = types.ModuleType("backend.app.telephony")
    telephony_pkg.__path__ = [str(ROOT_DIR / "backend" / "app" / "telephony")]
    sys.modules["backend.app.telephony"] = telephony_pkg
    backend_app_pkg.telephony = telephony_pkg  # type: ignore[attr-defined]
else:
    telephony_pkg = sys.modules["backend.app.telephony"]

from backend.app.telephony.voice_bridge import (  # noqa: E402
    RtpPacket,
    TelephonyVoiceBridge,
    VoiceBridgeError,
    VoiceBridgeHooks,
    VoiceBridgeMetricsRecorder,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _FakeWebSocket:
    def __init__(self, responses: list[dict[str, Any]]) -> None:
        self._responses = asyncio.Queue()
        for item in responses:
            self._responses.put_nowait(item)
        self.sent: list[dict[str, Any]] = []
        self.closed = False

    async def send(self, payload: str | bytes) -> None:
        data = payload.decode("utf-8") if isinstance(payload, bytes) else payload
        self.sent.append(json.loads(data))

    async def recv(self) -> str:
        if self.closed and self._responses.empty():
            raise StopAsyncIteration
        if self._responses.empty():
            self.closed = True
            raise StopAsyncIteration
        message = await self._responses.get()
        return json.dumps(message)

    async def close(self, code: int = 1000) -> None:
        self.closed = True


class _FakeRtpStream(AsyncIterator[RtpPacket]):
    def __init__(self, packets: list[RtpPacket]) -> None:
        self._packets = list(packets)

    def __aiter__(self) -> "_FakeRtpStream":
        return self

    async def __anext__(self) -> RtpPacket:
        if not self._packets:
            raise StopAsyncIteration
        await asyncio.sleep(0)
        return self._packets.pop(0)


@pytest.mark.anyio
async def test_voice_bridge_forwards_audio_and_transcripts() -> None:
    pcm_samples = struct.pack("<8h", 0, 500, -500, 1000, -1000, 500, 0, -500)
    mu_law = audioop.lin2ulaw(pcm_samples, 2)
    packets = [
        RtpPacket(payload=mu_law, timestamp=0, sequence_number=1),
        RtpPacket(payload=mu_law, timestamp=160, sequence_number=2),
    ]
    stream = _FakeRtpStream(packets)

    outbound_audio = []

    async def _send_to_peer(chunk: bytes) -> None:
        outbound_audio.append(chunk)

    resume_calls: list[list[dict[str, str]]] = []
    close_calls = 0
    clear_calls = 0

    sniff_calls: list[tuple[str, bytes]] = []

    async def _sniff(direction: str, chunk: bytes) -> None:
        sniff_calls.append((direction, chunk))

    async def _close_dialog() -> None:
        nonlocal close_calls
        close_calls += 1

    async def _clear_state() -> None:
        nonlocal clear_calls
        clear_calls += 1

    async def _resume(transcripts: list[dict[str, str]]) -> None:
        resume_calls.append(transcripts)

    hooks = VoiceBridgeHooks(
        close_dialog=_close_dialog,
        clear_voice_state=_clear_state,
        resume_workflow=_resume,
    )
    metrics = VoiceBridgeMetricsRecorder()

    assistant_audio = base64.b64encode(b"assistant-audio").decode("ascii")
    responses = [
        {"type": "response.output_audio.delta", "delta": {"audio": assistant_audio}},
        {
            "type": "response.transcript.delta",
            "response_id": "resp-1",
            "delta": {"text": "Bonjour "},
        },
        {
            "type": "response.transcript.delta",
            "response_id": "resp-1",
            "delta": {"text": "le monde"},
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp-1",
                "output": [
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Bonjour le monde"}
                        ],
                    }
                ],
            },
        },
    ]
    fake_ws = _FakeWebSocket(responses)

    connector_calls: list[tuple[str, dict[str, str]]] = []

    async def _connector(url: str, headers: dict[str, str]) -> _FakeWebSocket:
        connector_calls.append((url, headers))
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=hooks,
        metrics=metrics,
        websocket_connector=_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Soyez brefs",
        voice="verse",
        rtp_stream=stream,
        send_to_peer=_send_to_peer,
        sniff=_sniff,
    )

    assert stats.error is None
    assert stats.inbound_audio_bytes > 0
    assert outbound_audio == [b"assistant-audio"]

    assert close_calls == 1
    assert clear_calls == 1
    assert resume_calls == [[{"role": "assistant", "text": "Bonjour le monde"}]]

    session_update = fake_ws.sent[0]
    assert session_update["type"] == "session.update"
    assert session_update["session"]["instructions"] == "Soyez brefs"
    assert session_update["session"]["voice"] == "verse"
    turn_detection = (
        session_update["session"]["audio"]["input"].get("turn_detection") or {}
    )
    assert turn_detection.get("type") == "semantic_vad"

    append_payload = fake_ws.sent[1]
    assert append_payload["type"] == "input_audio_buffer.append"
    pcm8k = audioop.ulaw2lin(mu_law, 2)
    pcm16k, _ = audioop.ratecv(pcm8k, 2, 1, 8000, 16_000, None)
    expected_audio = base64.b64encode(pcm16k).decode("ascii")
    assert append_payload["audio"] == expected_audio

    assert fake_ws.sent[2]["type"] == "input_audio_buffer.commit"
    assert fake_ws.sent[3]["type"] == "response.create"

    snapshot = metrics.snapshot()
    assert snapshot["total_sessions"] == 1
    assert snapshot["total_errors"] == 0
    assert snapshot["total_outbound_audio_bytes"] == len(b"assistant-audio")

    directions = {direction for direction, _ in sniff_calls}
    assert "inbound" in directions
    assert "outbound" in directions
    assert any(len(chunk) > 0 for direction, chunk in sniff_calls if direction == "inbound")


@pytest.mark.anyio
async def test_voice_bridge_handles_realtime_error() -> None:
    stream = _FakeRtpStream([])
    outbound_audio: list[bytes] = []

    async def _send_to_peer(chunk: bytes) -> None:
        outbound_audio.append(chunk)

    close_called = False
    clear_called = False
    resume_called = False

    async def _close() -> None:
        nonlocal close_called
        close_called = True

    async def _clear() -> None:
        nonlocal clear_called
        clear_called = True

    async def _resume(_: list[dict[str, str]]) -> None:
        nonlocal resume_called
        resume_called = True

    hooks = VoiceBridgeHooks(
        close_dialog=_close,
        clear_voice_state=_clear,
        resume_workflow=_resume,
    )
    metrics = VoiceBridgeMetricsRecorder()

    responses = [{"type": "error", "error": {"message": "oups"}}]
    fake_ws = _FakeWebSocket(responses)

    async def _connector(url: str, headers: dict[str, str]) -> _FakeWebSocket:
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=hooks,
        metrics=metrics,
        websocket_connector=_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Continuez",
        voice=None,
        rtp_stream=stream,
        send_to_peer=_send_to_peer,
    )

    assert isinstance(stats.error, VoiceBridgeError)
    assert outbound_audio == []
    assert close_called
    assert clear_called
    assert not resume_called

    snapshot = metrics.snapshot()
    assert snapshot["total_sessions"] == 1
    assert snapshot["total_errors"] == 1
