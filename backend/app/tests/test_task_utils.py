import asyncio
import logging
import sys
import types
from pathlib import Path

import pytest


def ensure_backend_package_stub() -> None:
    backend_root = Path(__file__).resolve().parents[2]
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


ensure_backend_package_stub()

from backend.app.telephony.task_utils import StopController  # noqa: E402


@pytest.fixture(autouse=True)
def stub_realtime_modules(monkeypatch):
    agents_module = types.ModuleType("agents")
    realtime_module = types.ModuleType("agents.realtime")
    model_inputs_module = types.ModuleType("agents.realtime.model_inputs")

    class RealtimeModelSendRawMessage:  # pragma: no cover - simple stub
        def __init__(self, message):
            self.message = message

    model_inputs_module.RealtimeModelSendRawMessage = RealtimeModelSendRawMessage

    monkeypatch.setitem(sys.modules, "agents", agents_module)
    monkeypatch.setitem(sys.modules, "agents.realtime", realtime_module)
    monkeypatch.setitem(
        sys.modules, "agents.realtime.model_inputs", model_inputs_module
    )


class _DummyLimiter:
    def __init__(self) -> None:
        self.calls = 0

    async def cancel_pending(self) -> None:
        self.calls += 1


class _FakeModel:
    def __init__(self) -> None:
        self.events: list[dict[str, str]] = []

    async def send_event(self, payload) -> None:
        self.events.append(payload.message)


class _FakeSession:
    def __init__(self) -> None:
        self._model = _FakeModel()


def test_stop_controller_sends_cancel_and_clear_once() -> None:
    async def scenario() -> None:
        stop_event = asyncio.Event()
        session = _FakeSession()
        limiter = _DummyLimiter()
        logger = logging.getLogger("test.stop_controller")

        controller = StopController(
            stop_event=stop_event,
            session_getter=lambda: session,
            task_limiter=limiter,
            logger_=logger,
        )

        await controller.request_stop()
        assert stop_event.is_set()
        assert session._model.events == [
            {"type": "response.cancel"},
            {"type": "input_audio_buffer.clear"},
        ]
        assert limiter.calls == 1

        await controller.request_stop()
        assert session._model.events == [
            {"type": "response.cancel"},
            {"type": "input_audio_buffer.clear"},
        ]
        assert limiter.calls == 1

    asyncio.run(scenario())


def test_stop_controller_handles_missing_session() -> None:
    async def scenario() -> None:
        stop_event = asyncio.Event()
        limiter = _DummyLimiter()
        controller = StopController(
            stop_event=stop_event,
            session_getter=lambda: None,
            task_limiter=limiter,
        )

        await controller.request_stop()
        assert stop_event.is_set()
        assert limiter.calls == 1

    asyncio.run(scenario())
