"""Tests ciblés sur la diffusion audio entrante du VoiceBridge."""

import asyncio
import sys
import time
import types
from pathlib import Path


def ensure_backend_package_stub() -> None:
    """Expose le package backend depuis les tests unitaires."""

    backend_root = Path(__file__).resolve().parents[1]
    project_root = backend_root.parent

    if str(project_root) not in sys.path:
        sys.path.insert(0, str(project_root))

    if "backend" not in sys.modules:
        backend_module = types.ModuleType("backend")
        backend_module.__path__ = [str(backend_root)]
        sys.modules["backend"] = backend_module

    if "backend.app" not in sys.modules:
        app_module = types.ModuleType("backend.app")
        app_module.__path__ = [str(backend_root / "app")]
        sys.modules["backend.app"] = app_module

    if "backend.app.telephony" not in sys.modules:
        telephony_module = types.ModuleType("backend.app.telephony")
        telephony_module.__path__ = [str(backend_root / "app" / "telephony")]
        sys.modules["backend.app.telephony"] = telephony_module

    if "backend.app.config" not in sys.modules:
        config_module = types.ModuleType("backend.app.config")

        class Settings:  # pragma: no cover - minimal stub
            model_api_base = "https://example.invalid"

        def get_settings() -> Settings:  # pragma: no cover - stub factory
            return Settings()

        config_module.Settings = Settings
        config_module.get_settings = get_settings
        sys.modules["backend.app.config"] = config_module

    if "agents" not in sys.modules:
        agents_module = types.ModuleType("agents")
        agents_module.__path__ = []
        sys.modules["agents"] = agents_module

    realtime_module = types.ModuleType("agents.realtime")
    sys.modules["agents.realtime"] = realtime_module

    events_module = types.ModuleType("agents.realtime.events")

    class _BaseEvent:  # pragma: no cover - simple stub
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    for name in (
        "RealtimeAgentEndEvent",
        "RealtimeAgentStartEvent",
        "RealtimeAudio",
        "RealtimeAudioEnd",
        "RealtimeAudioInterrupted",
        "RealtimeError",
        "RealtimeHistoryAdded",
        "RealtimeHistoryUpdated",
        "RealtimeToolEnd",
        "RealtimeToolStart",
    ):
        setattr(events_module, name, type(name, (_BaseEvent,), {}))

    sys.modules["agents.realtime.events"] = events_module

    model_module = types.ModuleType("agents.realtime.model")

    class _RealtimePlaybackTracker:  # pragma: no cover - stub base
        def set_interrupt_callback(self, callback):
            self._callback = callback

    model_module.RealtimePlaybackTracker = _RealtimePlaybackTracker
    model_module.RealtimePlaybackState = dict

    sys.modules["agents.realtime.model"] = model_module

    model_inputs_module = types.ModuleType("agents.realtime.model_inputs")

    class RealtimeModelRawClientMessage:  # pragma: no cover - stub
        def __init__(self, **kwargs):
            self.data = kwargs

    class RealtimeModelSendRawMessage:  # pragma: no cover - stub
        def __init__(self, message):
            self.message = message

    model_inputs_module.RealtimeModelRawClientMessage = RealtimeModelRawClientMessage
    model_inputs_module.RealtimeModelSendRawMessage = RealtimeModelSendRawMessage

    sys.modules["agents.realtime.model_inputs"] = model_inputs_module


ensure_backend_package_stub()

from backend.app.telephony.voice_bridge import (  # noqa: E402
    RtpPacket,
    TelephonyVoiceBridge,
    VoiceBridgeHooks,
    _AsyncTaskLimiter,
)
from backend.app.telephony.call_diagnostics import get_diagnostics_manager  # noqa: E402


def test_async_task_limiter_throttles_concurrency():
    async def scenario() -> None:
        limiter = _AsyncTaskLimiter(name="test", max_pending=2)
        active = 0
        peak_active = 0
        finished = asyncio.Event()

        async def job() -> None:
            nonlocal active, peak_active
            active += 1
            peak_active = max(peak_active, active)
            await asyncio.sleep(0.05)
            active -= 1
            if active == 0:
                finished.set()

        async def submit_job() -> None:
            await limiter.submit(job())

        submitters = [asyncio.create_task(submit_job()) for _ in range(5)]
        await asyncio.gather(*submitters)

        await asyncio.wait_for(finished.wait(), timeout=1)
        assert peak_active <= 2

        # Schedule blocking jobs to ensure cancel_pending() clears them
        blocker = asyncio.Event()
        cancel_events: list[asyncio.Event] = []

        async def blocking_job() -> None:
            done = asyncio.Event()
            cancel_events.append(done)
            try:
                await blocker.wait()
            except asyncio.CancelledError:
                done.set()
                raise

        await limiter.submit(blocking_job())
        await limiter.submit(blocking_job())
        await asyncio.sleep(0)

        await limiter.cancel_pending()
        assert limiter.pending == 0
        assert all(event.is_set() for event in cancel_events)

    asyncio.run(scenario())


def test_forward_audio_dispatches_hook_before_send(monkeypatch):
    async def scenario() -> None:
        hook_started = asyncio.Event()
        hook_calls = 0
        diag_manager = get_diagnostics_manager()
        diag_manager.cleanup_old_calls(keep_last_n=0)
        diag = diag_manager.start_call("call-test")

        async def on_audio_inbound(pcm: bytes) -> None:
            nonlocal hook_calls
            hook_calls += 1
            hook_started.set()
            await asyncio.sleep(0)

        hooks = VoiceBridgeHooks(on_audio_inbound=on_audio_inbound)
        bridge = TelephonyVoiceBridge(hooks=hooks, input_codec="pcm")
        assert bridge._hooks.on_audio_inbound is on_audio_inbound

        submit_calls = 0

        async def tracking_submit(self, coro):
            nonlocal submit_calls
            submit_calls += 1
            hook_started.set()
            await coro
            return None

        monkeypatch.setattr(
            _AsyncTaskLimiter, "submit", tracking_submit
        )

        class FakeModel:
            def __init__(self) -> None:
                self.events: list = []

            async def send_event(self, event) -> None:  # pragma: no cover - helper
                self.events.append(event)

        class FakeSession:
            def __init__(self) -> None:
                self._model = FakeModel()
                self.sent_audio: list[tuple[bytes, bool]] = []

            def __aiter__(self):
                return self

            async def __anext__(self):
                raise StopAsyncIteration

            async def send_audio(self, pcm: bytes, commit: bool = False) -> None:
                self.sent_audio.append((pcm, commit))
                await asyncio.sleep(0)
                await asyncio.wait_for(hook_started.wait(), timeout=1)

            async def interrupt(self) -> None:  # pragma: no cover - stub method
                return None

        fake_session = FakeSession()

        class FakeAudioBridge:
            def __init__(self) -> None:
                self._chatkit_call_id = diag.call_id
                self._t0_first_rtp = time.monotonic()

            def reset_all(self) -> None:
                return None

            def send_prime_silence_direct(self, *, num_frames: int) -> None:
                return None

            def enable_audio_output(self) -> None:
                return None

        async def rtp_stream():
            yield RtpPacket(payload=b"\x01\x02", timestamp=0, sequence_number=0)
            await asyncio.sleep(0)

        async def send_to_peer(_: bytes) -> None:
            return None

        stats = await bridge.run(
            runner=None,
            client_secret="",
            model="gpt",
            instructions="test",
            voice=None,
            rtp_stream=rtp_stream(),
            send_to_peer=send_to_peer,
            clear_audio_queue=lambda: 0,
            audio_bridge=FakeAudioBridge(),
            _existing_session=fake_session,
            _existing_playback_tracker=None,
        )

        assert stats.inbound_audio_bytes > 0
        assert submit_calls == 1
        assert hook_calls == 1
        assert fake_session.sent_audio
        assert diag.phase_first_rtp.metadata["browser_stream_lead_ms"] >= 0

        diag_manager.cleanup_old_calls(keep_last_n=0)

    asyncio.run(scenario())
