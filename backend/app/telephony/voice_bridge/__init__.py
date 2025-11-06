"""Components for the telephony voice bridge."""

# Import from submodules
from .audio_pipeline import AudioStreamManager
from .event_router import RealtimeEventRouter
from .sip_sync import SipSyncController

# Import from parent voice_bridge.py module
# We need to import it indirectly to avoid Python's package/module precedence issues
import sys
from pathlib import Path
import importlib.util

_parent_loaded = False

def _ensure_parent_loaded():
    """Load the parent voice_bridge.py file and import its exports."""
    global _parent_loaded
    if _parent_loaded:
        return

    parent_module_path = Path(__file__).resolve().parent.parent / "voice_bridge.py"
    spec = importlib.util.spec_from_file_location(
        "app.telephony._voice_bridge_impl",
        parent_module_path
    )
    if spec and spec.loader:
        parent_module = importlib.util.module_from_spec(spec)
        sys.modules["app.telephony._voice_bridge_impl"] = parent_module
        spec.loader.exec_module(parent_module)

        # Import the classes into this module's namespace
        globals()["RtpPacket"] = parent_module.RtpPacket
        globals()["TelephonyVoiceBridge"] = parent_module.TelephonyVoiceBridge
        globals()["VoiceBridgeError"] = parent_module.VoiceBridgeError
        globals()["VoiceBridgeHooks"] = parent_module.VoiceBridgeHooks
        globals()["VoiceBridgeMetricsRecorder"] = parent_module.VoiceBridgeMetricsRecorder
        globals()["VoiceBridgeStats"] = parent_module.VoiceBridgeStats
        globals()["build_realtime_ws_url"] = parent_module.build_realtime_ws_url
        globals()["default_websocket_connector"] = parent_module.default_websocket_connector

        _parent_loaded = True

def __getattr__(name):
    """Lazy load classes from parent voice_bridge.py module."""
    if name in {
        "RtpPacket",
        "TelephonyVoiceBridge",
        "VoiceBridgeError",
        "VoiceBridgeHooks",
        "VoiceBridgeMetricsRecorder",
        "VoiceBridgeStats",
        "build_realtime_ws_url",
        "default_websocket_connector",
    }:
        _ensure_parent_loaded()
        if name in globals():
            return globals()[name]

    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")

__all__ = [
    "AudioStreamManager",
    "RealtimeEventRouter",
    "SipSyncController",
    "RtpPacket",
    "TelephonyVoiceBridge",
    "VoiceBridgeError",
    "VoiceBridgeHooks",
    "VoiceBridgeMetricsRecorder",
    "VoiceBridgeStats",
    "build_realtime_ws_url",
    "default_websocket_connector",
]
