"""Tests pour la configuration PJSUA."""

from __future__ import annotations

import logging
import sys
import types
from importlib import reload
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path
from unittest.mock import MagicMock, patch

APP_DIR = Path(__file__).resolve().parents[1] / "app"
TELEPHONY_DIR = APP_DIR / "telephony"


def ensure_app_package_stub() -> None:
    """Garantit l'existence de packages factices pour `app` et `app.telephony`."""

    if "app" not in sys.modules:
        app_module = types.ModuleType("app")
        app_module.__path__ = [str(APP_DIR)]
        sys.modules["app"] = app_module

    if "app.telephony" not in sys.modules:
        telephony_module = types.ModuleType("app.telephony")
        telephony_module.__path__ = [str(TELEPHONY_DIR)]
        sys.modules["app.telephony"] = telephony_module


def load_module(module_name: str, file_path: Path):
    """Charge dynamiquement un module en contournant les dépendances lourdes."""

    ensure_app_package_stub()
    sys.modules.pop(module_name, None)
    spec = spec_from_file_location(module_name, file_path)
    if spec is None or spec.loader is None:  # pragma: no cover - garde-fou
        raise ImportError(f"Impossible de charger {module_name}")
    module = module_from_spec(spec)
    sys.modules[module_name] = module
    spec.loader.exec_module(module)
    return module


def load_pjsua_config_module():
    return load_module("app.telephony.pjsua_config", TELEPHONY_DIR / "pjsua_config.py")


class TestEnsureEnvironmentOverrides:
    """Vérifie l'application des variables d'environnement."""

    def test_sets_defaults_when_missing(self, caplog):
        env: dict[str, str] = {}
        logger = logging.getLogger("test.pjsua.config")
        module = load_pjsua_config_module()

        with caplog.at_level(logging.INFO):
            defaults = module.ensure_environment_overrides(env=env, logger=logger)

        expected_defaults = module.get_default_ports()
        assert defaults == expected_defaults
        assert env["PJSUA_RTP_PORT_START"] == str(expected_defaults.start)
        assert env["PJSUA_RTP_PORT_RANGE"] == str(expected_defaults.range)

    def test_preserves_existing_values(self):
        env = {
            "PJSUA_RTP_PORT_START": "12000",
            "PJSUA_RTP_PORT_RANGE": "42",
        }
        module = load_pjsua_config_module()

        defaults = module.ensure_environment_overrides(env=env)

        assert defaults.start == 12000
        assert defaults.range == 42
        assert env["PJSUA_RTP_PORT_START"] == "12000"
        assert env["PJSUA_RTP_PORT_RANGE"] == "42"


class TestAdapterInitialization:
    """Vérifie l'utilisation de la configuration dans l'adaptateur."""

    def test_adapter_invokes_environment_overrides(self, monkeypatch):
        pjsua_mock = MagicMock()
        pjsua_mock.Endpoint = MagicMock()

        with patch.dict("sys.modules", {"pjsua2": pjsua_mock}):
            load_pjsua_config_module()
            module = load_module(
                "app.telephony.pjsua_adapter",
                TELEPHONY_DIR / "pjsua_adapter.py",
            )
            module = reload(module)
            ensure_mock = MagicMock()
            monkeypatch.setattr(module, "ensure_environment_overrides", ensure_mock)

            module.PJSUAAdapter()

        ensure_mock.assert_called_once_with(logger=module.logger)
