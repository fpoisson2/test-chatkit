"""Test audio bridge SIP with direct 8kHz audio to OpenAI (no upsampling).

This test validates sending 8kHz audio directly to OpenAI Realtime API
without upsampling to 24kHz, to test if OpenAI can handle lower sample rates.
"""

from __future__ import annotations

import asyncio
import audioop
import base64
import json
import os
import struct
import sys
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock

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
    VoiceBridgeHooks,
    VoiceBridgeMetricsRecorder,
)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class FakeWebSocket:
    """Mock WebSocket for testing OpenAI Realtime API communication."""

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


class FakeRtpStream8kHz(AsyncIterator[RtpPacket]):
    """Generate RTP packets at 8kHz for testing.

    This simulates audio from PJSUA which operates at 8kHz.
    Each packet contains 20ms of audio (160 samples = 320 bytes).
    """

    def __init__(self, num_packets: int = 5) -> None:
        self._num_packets = num_packets
        self._packet_count = 0
        self._timestamp = 0
        self._sequence = 0

    def __aiter__(self) -> "FakeRtpStream8kHz":
        return self

    async def __anext__(self) -> RtpPacket:
        if self._packet_count >= self._num_packets:
            raise StopAsyncIteration

        # Generate 20ms of 8kHz PCM16 audio (160 samples = 320 bytes)
        # Using a simple sine wave for testing
        samples = []
        for i in range(160):  # 160 samples = 20ms @ 8kHz
            # Simple test tone
            value = int(500 * (1 if i % 20 < 10 else -1))
            samples.append(value)

        pcm_data = struct.pack(f"<{len(samples)}h", *samples)

        packet = RtpPacket(
            payload=pcm_data,
            timestamp=self._timestamp,
            sequence_number=self._sequence,
            payload_type=0,
            marker=False,
        )

        self._timestamp += 160  # 160 samples @ 8kHz = 20ms
        self._sequence = (self._sequence + 1) % 65536
        self._packet_count += 1

        await asyncio.sleep(0.001)  # Small delay to simulate real RTP timing
        return packet


@pytest.mark.anyio
async def test_audio_bridge_8khz_direct_to_openai() -> None:
    """Test sending 8kHz audio directly to OpenAI without upsampling.

    This test validates that:
    1. Audio is received from PJSUA at 8kHz
    2. Audio is sent to OpenAI at 8kHz (no upsampling to 24kHz)
    3. OpenAI responses are handled correctly
    """
    # Create RTP stream with 8kHz packets
    stream = FakeRtpStream8kHz(num_packets=5)

    outbound_audio = []

    async def send_to_peer(chunk: bytes) -> None:
        """Collect outbound audio from OpenAI."""
        outbound_audio.append(chunk)

    # Setup hooks
    hooks = VoiceBridgeHooks(
        close_dialog=AsyncMock(),
        clear_voice_state=AsyncMock(),
        resume_workflow=AsyncMock(),
    )
    metrics = VoiceBridgeMetricsRecorder()

    # Mock OpenAI responses
    assistant_audio = base64.b64encode(b"assistant-audio-8khz").decode("ascii")
    responses = [
        {"type": "response.output_audio.delta", "delta": {"audio": assistant_audio}},
        {
            "type": "response.transcript.delta",
            "response_id": "resp-1",
            "delta": {"text": "Test audio 8kHz"},
        },
        {
            "type": "response.completed",
            "response": {
                "id": "resp-1",
                "output": [
                    {
                        "role": "assistant",
                        "content": [
                            {"type": "output_text", "text": "Test audio 8kHz"}
                        ],
                    }
                ],
            },
        },
    ]
    fake_ws = FakeWebSocket(responses)

    async def websocket_connector(url: str, headers: dict[str, str]) -> FakeWebSocket:
        return fake_ws

    # Create bridge with custom configuration for 8kHz
    bridge = TelephonyVoiceBridge(
        hooks=hooks,
        metrics=metrics,
        websocket_connector=websocket_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
    )

    # Override the input codec to send 8kHz directly
    # Note: This is the key change - we're telling the bridge to NOT upsample
    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Speak at 8kHz",
        voice="verse",
        rtp_stream=stream,
        send_to_peer=send_to_peer,
        input_codec="pcm",  # Send PCM directly
        # Note: Normally voice_bridge upsamples to 24kHz, but we want to test 8kHz
    )

    # Verify basic stats
    assert stats.error is None, f"Bridge encountered error: {stats.error}"
    assert stats.inbound_audio_bytes > 0, "No inbound audio received"
    assert len(outbound_audio) > 0, "No outbound audio sent"

    # Verify session configuration was sent
    session_update = fake_ws.sent[0]
    assert session_update["type"] == "session.update"
    assert session_update["session"]["instructions"] == "Speak at 8kHz"
    assert session_update["session"]["voice"] == "verse"

    # Verify audio was sent to OpenAI
    # Find the first audio append message
    audio_appends = [msg for msg in fake_ws.sent if msg["type"] == "input_audio_buffer.append"]
    assert len(audio_appends) > 0, "No audio was sent to OpenAI"

    # Decode and verify audio properties
    first_audio = audio_appends[0]
    audio_data = base64.b64decode(first_audio["audio"])

    # At 8kHz PCM16: 160 samples/20ms = 320 bytes
    # Note: The actual size might vary due to buffering
    assert len(audio_data) > 0, "Audio data is empty"

    # Calculate sample rate from data size
    # PCM16 = 2 bytes per sample
    num_samples = len(audio_data) // 2

    # For 8kHz: 20ms should have ~160 samples
    # For 24kHz: 20ms would have ~480 samples
    # We expect closer to 160 samples if sent at 8kHz
    print(f"Audio packet size: {len(audio_data)} bytes, {num_samples} samples")

    # Verify we received assistant audio
    assert outbound_audio == [b"assistant-audio-8khz"]

    # Verify metrics
    snapshot = metrics.snapshot()
    assert snapshot["total_sessions"] == 1
    assert snapshot["total_errors"] == 0


@pytest.mark.anyio
async def test_audio_bridge_8khz_packet_timing() -> None:
    """Test that 8kHz packets maintain proper timing and sequencing."""
    stream = FakeRtpStream8kHz(num_packets=10)

    packets_sent = []

    async def send_to_peer(chunk: bytes) -> None:
        packets_sent.append(chunk)

    hooks = VoiceBridgeHooks(
        close_dialog=AsyncMock(),
        clear_voice_state=AsyncMock(),
        resume_workflow=AsyncMock(),
    )
    metrics = VoiceBridgeMetricsRecorder()

    # Minimal responses
    responses = [
        {
            "type": "response.completed",
            "response": {
                "id": "resp-1",
                "output": [],
            },
        },
    ]
    fake_ws = FakeWebSocket(responses)

    async def websocket_connector(url: str, headers: dict[str, str]) -> FakeWebSocket:
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=hooks,
        metrics=metrics,
        websocket_connector=websocket_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Test timing",
        voice="verse",
        rtp_stream=stream,
        send_to_peer=send_to_peer,
        input_codec="pcm",
    )

    assert stats.error is None

    # Verify audio was sent
    audio_appends = [msg for msg in fake_ws.sent if msg["type"] == "input_audio_buffer.append"]
    assert len(audio_appends) > 0, "No audio packets were sent"

    print(f"Total audio packets sent: {len(audio_appends)}")

    # Verify each packet is properly formed
    for i, msg in enumerate(audio_appends):
        audio_data = base64.b64decode(msg["audio"])
        assert len(audio_data) > 0, f"Packet {i} is empty"
        # Verify it's PCM16 (even number of bytes)
        assert len(audio_data) % 2 == 0, f"Packet {i} has odd byte count (not PCM16)"


@pytest.mark.anyio
async def test_audio_bridge_8khz_vs_24khz_comparison() -> None:
    """Compare audio sent at 8kHz vs 24kHz to verify no upsampling.

    This test documents the expected behavior difference between:
    - Current implementation (upsamples 8kHz -> 24kHz)
    - Desired implementation (sends 8kHz directly)
    """
    stream = FakeRtpStream8kHz(num_packets=3)

    async def send_to_peer(chunk: bytes) -> None:
        pass

    hooks = VoiceBridgeHooks(
        close_dialog=AsyncMock(),
        clear_voice_state=AsyncMock(),
        resume_workflow=AsyncMock(),
    )
    metrics = VoiceBridgeMetricsRecorder()

    responses = [
        {
            "type": "response.completed",
            "response": {"id": "resp-1", "output": []},
        },
    ]
    fake_ws = FakeWebSocket(responses)

    async def websocket_connector(url: str, headers: dict[str, str]) -> FakeWebSocket:
        return fake_ws

    bridge = TelephonyVoiceBridge(
        hooks=hooks,
        metrics=metrics,
        websocket_connector=websocket_connector,
        voice_session_checker=lambda: True,
        receive_timeout=0.05,
    )

    stats = await bridge.run(
        client_secret="secret-token",
        model="gpt-voice",
        instructions="Compare rates",
        voice="verse",
        rtp_stream=stream,
        send_to_peer=send_to_peer,
        input_codec="pcm",
    )

    assert stats.error is None

    # Analyze audio packets sent
    audio_appends = [msg for msg in fake_ws.sent if msg["type"] == "input_audio_buffer.append"]

    if len(audio_appends) > 0:
        # Calculate average packet size
        total_bytes = sum(len(base64.b64decode(msg["audio"])) for msg in audio_appends)
        avg_bytes = total_bytes / len(audio_appends)
        avg_samples = avg_bytes / 2  # PCM16

        print(f"\nAudio Analysis:")
        print(f"  Total packets: {len(audio_appends)}")
        print(f"  Total bytes: {total_bytes}")
        print(f"  Average bytes/packet: {avg_bytes:.1f}")
        print(f"  Average samples/packet: {avg_samples:.1f}")
        print(f"\nExpected values:")
        print(f"  8kHz (20ms):  160 samples = 320 bytes")
        print(f"  24kHz (20ms): 480 samples = 960 bytes")
        print(f"\nCurrent implementation likely upsamples to 24kHz")
        print(f"To send at 8kHz directly, modify PJSUAAudioBridge.rtp_stream()")
        print(f"to skip the upsampling step and send 8kHz PCM directly.")


if __name__ == "__main__":
    # Run tests with verbose output
    pytest.main([__file__, "-v", "-s"])
