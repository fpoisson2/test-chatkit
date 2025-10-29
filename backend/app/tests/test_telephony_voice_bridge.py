import asyncio
import audioop
import base64
import contextlib
import json
import os
import struct
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

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


class _ControlledRtpStream(AsyncIterator[RtpPacket]):
    """Flux RTP testable qui reste ouvert jusqu'à ce qu'on le stoppe."""

    def __init__(self, packets: list[RtpPacket]) -> None:
        self._packets = list(packets)
        self._stop_event = asyncio.Event()

    def stop(self) -> None:
        self._stop_event.set()

    def __aiter__(self) -> "_ControlledRtpStream":
        return self

    async def __anext__(self) -> RtpPacket:
        if self._packets:
            await asyncio.sleep(0)
            return self._packets.pop(0)

        await self._stop_event.wait()
        raise StopAsyncIteration


def _is_silence(chunk: bytes) -> bool:
    return not chunk or all(value == 0 for value in chunk)


class _IdleWebSocket:
    """WebSocket factice qui reste actif jusqu'à ce qu'on le débloque."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self._session_sent = False
        self._ended = asyncio.Event()
        self._end_sent = False
        self.closed = False

    async def send(self, payload: str | bytes) -> None:
        data = payload.decode("utf-8") if isinstance(payload, bytes) else payload
        self.sent.append(json.loads(data))

    async def recv(self) -> str:
        if not self._session_sent:
            self._session_sent = True
            return json.dumps(
                {
                    "type": "session.created",
                    "event_id": "evt_1",
                    "session": {
                        "type": "realtime",
                        "object": "realtime.session",
                        "id": "sess_idle",
                        "model": "gpt-realtime-mini",
                        "output_modalities": ["audio"],
                    },
                }
            )

        if self._ended.is_set():
            if self._end_sent:
                raise StopAsyncIteration
            self._end_sent = True
            return json.dumps({"type": "session.ended"})

        await asyncio.sleep(0.01)
        return json.dumps({"type": "mcp_list_tools.in_progress"})

    async def close(self, code: int = 1000) -> None:
        del code
        self.closed = True

    def finish(self) -> None:
        self._ended.set()


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
        target_sample_rate=8_000,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Soyez brefs",
        voice="verse",
        rtp_stream=stream,
        send_to_peer=_send_to_peer,
    )

    assert stats.error is None
    assert stats.inbound_audio_bytes > 0
    non_silence = [chunk for chunk in outbound_audio if not _is_silence(chunk)]
    assert non_silence == [b"assistant-audio"]
    assert all(
        _is_silence(chunk) or chunk == b"assistant-audio"
        for chunk in outbound_audio
    )

    assert close_calls == 1
    assert clear_calls == 1
    assert resume_calls == [[{"role": "assistant", "text": "Bonjour le monde"}]]

    session_update = fake_ws.sent[0]
    assert session_update["type"] == "session.update"
    session_payload = session_update["session"]
    assert session_payload["instructions"] == "Soyez brefs"
    assert session_payload["voice"] == "verse"
    realtime_payload = session_payload["realtime"]
    assert realtime_payload["turn_detection"]["type"] == "server_vad"
    assert realtime_payload["input_audio_format"] == {
        "type": "audio/pcm",
        "rate": 8_000,
    }

    append_payload = next(
        (
            entry
            for entry in fake_ws.sent
            if entry.get("type") == "input_audio_buffer.append"
        ),
        None,
    )
    assert append_payload is not None, fake_ws.sent
    decoded_audio = base64.b64decode(append_payload["audio"])
    assert decoded_audio, "expected non-empty audio payload"

    snapshot = metrics.snapshot()
    assert snapshot["total_sessions"] == 1
    assert snapshot["total_errors"] == 0
    assert snapshot["total_outbound_audio_bytes"] >= len(b"assistant-audio")


@pytest.mark.anyio
async def test_voice_bridge_continues_after_response_completed() -> None:
    pcm_samples = struct.pack("<8h", *([0, 500, -500, 1000] * 2))
    mu_law = audioop.lin2ulaw(pcm_samples, 2)
    stream = _ControlledRtpStream(
        [
            RtpPacket(payload=mu_law, timestamp=0, sequence_number=1),
        ]
    )

    outbound_audio: list[bytes] = []

    async def _send_to_peer(chunk: bytes) -> None:
        outbound_audio.append(chunk)

    resume_calls: list[list[dict[str, str]]] = []

    async def _resume(transcripts: list[dict[str, str]]) -> None:
        resume_calls.append(transcripts)

    first_chunk = base64.b64encode(b"premier").decode("ascii")
    second_chunk = base64.b64encode(b"deuxieme").decode("ascii")

    responses = [
        {
            "type": "response.output_audio.delta",
            "response_id": "resp-1",
            "delta": {"audio": first_chunk},
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp-1",
                "output": [
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Bonjour"},
                        ],
                    }
                ],
            },
        },
        {
            "type": "response.output_audio.delta",
            "response_id": "resp-2",
            "delta": {"audio": second_chunk},
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp-2",
                "output": [
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Encore"},
                        ],
                    }
                ],
            },
        },
        {"type": "session.ended"},
    ]

    fake_ws = _FakeWebSocket(responses)

    async def _connector(url: str, headers: dict[str, str]) -> _FakeWebSocket:
        del url, headers
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=VoiceBridgeHooks(resume_workflow=_resume),
        websocket_connector=_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
        target_sample_rate=8_000,
    )

    async def _stop_stream() -> None:
        await asyncio.sleep(0.05)
        stream.stop()

    stopper = asyncio.create_task(_stop_stream())
    try:
        stats = await bridge.run(
            client_secret="secret-token",
            model="gpt-voice",
            instructions="Parlez",
            voice="verse",
            rtp_stream=stream,
            send_to_peer=_send_to_peer,
        )
    finally:
        stopper.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await stopper

    assert stats.error is None
    non_silence = [chunk for chunk in outbound_audio if not _is_silence(chunk)]
    assert non_silence == [b"premier", b"deuxieme"]
    # Les deux réponses doivent être transmises au workflow de reprise
    assert resume_calls == [
        [
            {"role": "assistant", "text": "Bonjour"},
            {"role": "assistant", "text": "Encore"},
        ]
    ]


@pytest.mark.anyio
async def test_voice_bridge_sends_keepalive_when_idle() -> None:
    stream = _ControlledRtpStream([])

    outbound_audio: list[bytes] = []

    async def _send_to_peer(chunk: bytes) -> None:
        outbound_audio.append(chunk)

    idle_ws = _IdleWebSocket()

    async def _connector(url: str, headers: dict[str, str]) -> _IdleWebSocket:
        del url, headers
        return idle_ws

    bridge = TelephonyVoiceBridge(
        hooks=VoiceBridgeHooks(),
        websocket_connector=_connector,
        voice_session_checker=lambda: True,
        receive_timeout=1.0,
        target_sample_rate=8_000,
        keepalive_interval=0.05,
    )

    async def _supervisor() -> None:
        await asyncio.sleep(0.25)
        idle_ws.finish()
        stream.stop()

    supervisor = asyncio.create_task(_supervisor())
    try:
        stats = await bridge.run(
            client_secret="secret-token",
            model="gpt-voice",
            instructions="Restez en ligne",
            voice="verse",
            rtp_stream=stream,
            send_to_peer=_send_to_peer,
        )
    finally:
        supervisor.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await supervisor

    assert stats.error is None
    assert outbound_audio, "le pont doit envoyer du silence en keepalive"
    assert all(_is_silence(chunk) for chunk in outbound_audio)


@pytest.mark.anyio
async def test_voice_bridge_uses_session_config() -> None:
    stream = _FakeRtpStream([])

    async def _send_to_peer(_: bytes) -> None:
        return None

    session_config = {
        "model": "gpt-voice",
        "instructions": "Workflow instructions",
        "voice": "ember",
        "realtime": {
            "start_mode": "manual",
            "stop_mode": "manual",
            "turn_detection": {"type": "server_vad", "threshold": 0.25},
            "input_audio_format": {"type": "audio/pcm", "rate": 44100},
        },
        "tools": [{"type": "web_search"}],
    }

    responses: list[dict[str, Any]] = []
    fake_ws = _FakeWebSocket(responses)

    async def _connector(url: str, headers: dict[str, str]) -> _FakeWebSocket:
        del url, headers
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=VoiceBridgeHooks(),
        websocket_connector=_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
        target_sample_rate=8_000,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="unused-model",
        instructions="Fallback",
        voice=None,
        rtp_stream=stream,
        send_to_peer=_send_to_peer,
        session_config=session_config,
        tool_permissions={"response": True},
    )

    assert stats.error is None
    assert fake_ws.sent, "session.update message must be sent"
    session_payload = fake_ws.sent[0]["session"]
    assert session_payload["model"] == "gpt-voice"
    assert session_payload["instructions"] == "Workflow instructions"
    assert session_payload["voice"] == "ember"
    assert session_payload["tools"] == [{"type": "web_search"}]
    assert session_payload["tool_permissions"] == {"response": True}
    audio_section = session_payload.get("audio")
    assert isinstance(audio_section, dict)
    input_audio = audio_section.get("input")
    assert isinstance(input_audio, dict)
    assert input_audio["format"] == {"type": "audio/pcm", "rate": 8_000}
    assert input_audio["turn_detection"] == {"type": "server_vad", "threshold": 0.25}
    assert "realtime" not in session_payload


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
        target_sample_rate=8_000,
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
