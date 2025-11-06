from __future__ import annotations

import asyncio
import os
import sys
from importlib import import_module
from importlib.machinery import ModuleSpec
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

import pytest

APP_DIR = Path(__file__).resolve().parents[1]
assert APP_DIR.name == "app"
if str(APP_DIR) not in sys.path:
    sys.path.insert(0, str(APP_DIR))

sys.modules.setdefault("fastapi", MagicMock())
sys.modules.setdefault("fastapi.middleware.cors", MagicMock())
sys.modules.setdefault("dotenv", MagicMock())
sys.modules.setdefault("pydantic", MagicMock())
sys.modules.setdefault("sqlalchemy", MagicMock())
sys.modules.setdefault("sqlalchemy.exc", MagicMock())
sys.modules.setdefault("sqlalchemy.orm", MagicMock())
sys.modules.setdefault("sqlalchemy.engine", MagicMock())
sys.modules.setdefault("pgvector", MagicMock())
sys.modules.setdefault("pgvector.sqlalchemy", MagicMock())
sys.modules.setdefault("sqlalchemy.dialects", MagicMock())
sys.modules.setdefault("sqlalchemy.dialects.postgresql", MagicMock())
sys.modules.setdefault("sqlalchemy.types", MagicMock())

os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "test")
os.environ.setdefault("OPENAI_API_KEY", "test-key")

def _ensure_package(
    monkeypatch: pytest.MonkeyPatch, name: str, path: Path
) -> ModuleType:
    module = ModuleType(name)
    module.__path__ = [str(path)]
    module.__package__ = name
    module.__spec__ = ModuleSpec(name=name, loader=None, is_package=True)
    monkeypatch.setitem(sys.modules, name, module)
    return module


def _prepare_telephony_modules(
    monkeypatch: pytest.MonkeyPatch,
) -> SimpleNamespace:
    modules_to_clear = [
        "app",
        "app.telephony",
        "telephony",
        "app.telephony.config",
        "app.telephony.media",
        "app.telephony.callbacks",
        "app.telephony.pjsua_errors",
        "app.telephony.pjsua_lib",
        "app.telephony.pjsua_adapter",
        "telephony.config",
        "telephony.media",
        "telephony.callbacks",
        "telephony.pjsua_errors",
        "telephony.pjsua_lib",
        "telephony.pjsua_adapter",
        "app.models",
    ]

    for module_name in modules_to_clear:
        monkeypatch.delitem(sys.modules, module_name, raising=False)

    app_pkg = _ensure_package(monkeypatch, "app", APP_DIR)
    telephony_pkg = _ensure_package(monkeypatch, "app.telephony", APP_DIR / "telephony")
    app_pkg.telephony = telephony_pkg
    monkeypatch.setitem(sys.modules, "telephony", telephony_pkg)

    models_module = ModuleType("app.models")
    models_module.__package__ = "app"

    class _StubSipAccount:  # pragma: no cover - only used for lazy imports
        """Minimal stand-in for the real SQLAlchemy model."""

        id: int = 1
        label: str = "stub"
        trunk_uri: str = "sip:stub@example.com"
        username: str | None = None
        password: str | None = None
        contact_port: int | None = None
        is_active: bool = True
        is_default: bool = True

    models_module.SipAccount = _StubSipAccount
    monkeypatch.setitem(sys.modules, "app.models", models_module)

    config_module = import_module("app.telephony.config")
    media_module = import_module("app.telephony.media")
    callbacks_module = import_module("app.telephony.callbacks")
    errors_module = import_module("app.telephony.pjsua_errors")
    lib_module = import_module("app.telephony.pjsua_lib")

    monkeypatch.setitem(sys.modules, "telephony.config", config_module)
    monkeypatch.setitem(sys.modules, "telephony.media", media_module)
    monkeypatch.setitem(sys.modules, "telephony.callbacks", callbacks_module)
    monkeypatch.setitem(sys.modules, "telephony.pjsua_errors", errors_module)
    monkeypatch.setitem(sys.modules, "telephony.pjsua_lib", lib_module)

    return SimpleNamespace(
        config=config_module,
        media=media_module,
        callbacks=callbacks_module,
        errors=errors_module,
        lib=lib_module,
    )


class FakeEpConfig:
    def __init__(self) -> None:
        self.logConfig = SimpleNamespace(level=None, consoleLevel=None)
        self.uaConfig = SimpleNamespace(
            mainThreadOnly=None,
            natTypeInSdp=None,
            timerUse=None,
            timerMinSE=None,
            timerSessExpires=None,
        )
        self.medConfig = SimpleNamespace(
            jb_init=None,
            jb_min_pre=None,
            jb_max_pre=None,
            jb_max=None,
            snd_auto_close_time=None,
            rtp_port=None,
            rtp_port_range=None,
            rtpStart=None,
            portRange=None,
            enable_ice=False,
            enable_rtcp_mux=None,
            no_vad=None,
            ice_no_host_cands=None,
            ecTailLen=None,
            srtpOpt=None,
        )


class FakeTransportConfig:
    def __init__(self) -> None:
        self.port: int | None = None


def test_initialize_applies_configuration(monkeypatch: pytest.MonkeyPatch) -> None:
    modules = _prepare_telephony_modules(monkeypatch)

    # Prepare fake pj module used by the adapter
    fake_ep_config = FakeEpConfig()
    fake_endpoint = MagicMock()
    fake_endpoint.libInit = MagicMock()
    fake_endpoint.audDevManager.return_value.setNullDev = MagicMock()
    fake_endpoint.transportCreate = MagicMock()
    fake_endpoint.libStart = MagicMock()
    fake_endpoint.libGetConfig.return_value = fake_ep_config

    observed_transport_port: dict[str, Any] = {}

    def fake_transport_settings(*, port: int) -> modules.config.TransportSettings:
        observed_transport_port["value"] = port
        return modules.config.TransportSettings(port=7575)

    monkeypatch.setattr(
        modules.config,
        "logging_settings",
        lambda: modules.config.LoggingSettings(level=5, console_level=7),
    )
    monkeypatch.setattr(
        modules.config,
        "session_timer_settings",
        lambda: modules.config.SessionTimerSettings(
            main_thread_only=True,
            nat_type_in_sdp=3,
            timer_use=9,
            timer_min_se=45,
            timer_sess_expires=120,
        ),
    )
    monkeypatch.setattr(
        modules.config,
        "jitter_buffer_settings",
        lambda: modules.config.JitterBufferSettings(
            jb_init=2,
            jb_min_pre=3,
            jb_max_pre=5,
            jb_max=9,
            snd_auto_close_time=2,
        ),
    )
    monkeypatch.setattr(
        modules.config,
        "rtp_settings",
        lambda: modules.config.RtpSettings(start_port=4321, port_range=12),
    )
    monkeypatch.setattr(
        modules.config,
        "media_feature_settings",
        lambda *, nomadic_mode: modules.config.MediaFeatureSettings(
            enable_ice=nomadic_mode,
            enable_rtcp_mux=False,
            no_vad=False,
            ice_no_host_cands=False,
            ec_tail_len=4,
            srtp_opt=3,
        ),
    )
    monkeypatch.setattr(modules.config, "transport_settings", fake_transport_settings)

    fake_pj = SimpleNamespace(
        Endpoint=lambda: fake_endpoint,
        EpConfig=lambda: fake_ep_config,
        TransportConfig=FakeTransportConfig,
        PJSIP_TRANSPORT_UDP=0,
    )

    adapter_module = import_module("app.telephony.pjsua_adapter")
    monkeypatch.setattr(adapter_module, "pj", fake_pj)
    monkeypatch.setattr(adapter_module, "PJSUA_AVAILABLE", True)

    pjsua_module = sys.modules["app.telephony.pjsua_adapter"]
    PJSUAAdapter = pjsua_module.PJSUAAdapter

    adapter = PJSUAAdapter()
    loop = asyncio.new_event_loop()
    try:
        adapter._loop = loop
        loop.run_until_complete(
            adapter.initialize(config=None, port=6060, nomadic_mode=True)
        )
    finally:
        loop.run_until_complete(adapter.shutdown())
        loop.close()

    # Ensure endpoint lifecycle was invoked with our fake config
    fake_endpoint.libInit.assert_called_once()
    assert fake_endpoint.libInit.call_args[0][0] is fake_ep_config
    fake_endpoint.audDevManager.return_value.setNullDev.assert_called_once()
    fake_endpoint.transportCreate.assert_called_once()
    transport_arg = fake_endpoint.transportCreate.call_args[0][1]
    assert isinstance(transport_arg, FakeTransportConfig)
    assert transport_arg.port == 7575
    assert observed_transport_port["value"] == 6060

    # Log configuration must reflect patched values
    assert fake_ep_config.logConfig.level == 5
    assert fake_ep_config.logConfig.consoleLevel == 7

    ua_cfg = fake_ep_config.uaConfig
    assert ua_cfg.mainThreadOnly is True
    assert ua_cfg.natTypeInSdp == 3
    assert ua_cfg.timerUse == 9
    assert ua_cfg.timerMinSE == 45
    assert ua_cfg.timerSessExpires == 120

    media_cfg = fake_ep_config.medConfig
    assert media_cfg.jb_init == 2
    assert media_cfg.jb_min_pre == 3
    assert media_cfg.jb_max_pre == 5
    assert media_cfg.jb_max == 9
    assert media_cfg.snd_auto_close_time == 2
    assert media_cfg.rtp_port == 4321
    assert media_cfg.rtp_port_range == 12
    assert media_cfg.rtpStart == 4321
    assert media_cfg.portRange == 12
    assert media_cfg.enable_ice is True
    assert media_cfg.enable_rtcp_mux is False
    assert media_cfg.no_vad is False
    assert media_cfg.ice_no_host_cands is False
    assert media_cfg.ecTailLen == 4
    assert media_cfg.srtpOpt == 3

    fake_endpoint.libStart.assert_called_once()
