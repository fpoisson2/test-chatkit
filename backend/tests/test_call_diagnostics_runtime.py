"""Tests pour la gestion runtime des diagnostics d'appel."""

import asyncio
import queue
import sys
import types
from pathlib import Path
from types import SimpleNamespace


def ensure_backend_package_stub() -> None:
    """Crée un stub minimal pour `backend` afin d'éviter d'importer FastAPI."""

    backend_root = Path(__file__).resolve().parents[1]
    app_root = backend_root / "app"
    telephony_root = app_root / "telephony"

    if "backend" not in sys.modules:
        backend_module = types.ModuleType("backend")
        backend_module.__path__ = [str(backend_root)]
        sys.modules["backend"] = backend_module

    if "backend.app" not in sys.modules:
        app_module = types.ModuleType("backend.app")
        app_module.__path__ = [str(app_root)]
        sys.modules["backend.app"] = app_module

    if "backend.app.telephony" not in sys.modules:
        telephony_module = types.ModuleType("backend.app.telephony")
        telephony_module.__path__ = [str(telephony_root)]
        sys.modules["backend.app.telephony"] = telephony_module


ensure_backend_package_stub()

from backend.app.telephony.call_diagnostics import CallDiagnostics  # noqa: E402
from backend.app.telephony.pjsua_adapter import PJSUACall  # noqa: E402


class FakePort:
    """Port audio minimal pour tester CallDiagnostics.prepare_audio_port."""

    def __init__(self) -> None:
        self._frame_requested_event = None
        self._audio_bridge = None
        self._incoming_audio_queue: queue.Queue[bytes] = queue.Queue()
        self._outgoing_audio_queue: queue.Queue[bytes] = queue.Queue()
        self._frame_count = 5
        self._audio_frame_count = 3
        self._silence_frame_count = 2
        self._frame_received_count = 1
        self._active = False


def test_prepare_audio_port_resets_state_and_buffers() -> None:
    """Le reset du port doit vider les queues et remettre les compteurs à zéro."""

    diag = CallDiagnostics(call_id="test-call")
    port = FakePort()
    port._incoming_audio_queue.put(b"foo")
    port._incoming_audio_queue.put(b"bar")
    port._outgoing_audio_queue.put(b"baz")

    event = asyncio.Event()
    drained_in, drained_out = diag.prepare_audio_port(
        port,
        event,
        audio_bridge="bridge",
    )

    assert drained_in == 2
    assert drained_out == 1
    assert port._frame_requested_event is event
    assert port._audio_bridge == "bridge"
    assert port._active is True
    assert port._frame_count == 0
    assert port._audio_frame_count == 0
    assert port._silence_frame_count == 0
    assert port._frame_received_count == 0
    assert diag.buffers_state["incoming_queue_before_call"] == 2
    assert diag.buffers_state["outgoing_queue_before_call"] == 1
    assert diag.frames_requested == 0
    assert diag.outgoing_audio_frames == 0
    assert diag.outgoing_silence_frames == 0
    assert diag.incoming_frames == 0


def test_pjsua_call_wraps_diagnostics_state() -> None:
    """PJSUACall doit déléguer les indicateurs runtime vers CallDiagnostics."""

    diag = CallDiagnostics(call_id="pjsua-test")
    diag.cleanup_done = True  # Doit être réinitialisé par l'init
    adapter = SimpleNamespace(_loop=None, _account=None)

    call = PJSUACall(adapter, diagnostics=diag)

    # L'init doit avoir réinitialisé les indicateurs de cleanup
    assert call.diagnostics is diag
    assert call.diagnostics.cleanup_done is False

    # Propriété chatkit_call_id -> diagnostics
    call.chatkit_call_id = "abc"
    assert call.chatkit_call_id == "abc"
    assert call.diagnostics.chatkit_call_id == "abc"

    # Le setter _cleanup_done doit propager l'état
    call._cleanup_done = True
    assert call.diagnostics.cleanup_done is True
    call._cleanup_done = False
    assert call.diagnostics.cleanup_done is False

    # Marquage manuel des états de terminaison/fermeture
    call.diagnostics.mark_terminated()
    call.diagnostics.mark_closed()
    assert call.diagnostics.call_terminated is True
    assert call.diagnostics.call_closed is True
