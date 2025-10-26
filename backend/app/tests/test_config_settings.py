from __future__ import annotations

import importlib.util
import os
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///tmp.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

CONFIG_SPEC = importlib.util.spec_from_file_location(
    "app.config", ROOT_DIR / "app" / "config.py"
)
assert CONFIG_SPEC is not None and CONFIG_SPEC.loader is not None
config_module = importlib.util.module_from_spec(CONFIG_SPEC)
sys.modules[CONFIG_SPEC.name] = config_module
CONFIG_SPEC.loader.exec_module(config_module)
Settings = config_module.Settings
DEFAULT_THREAD_TITLE_PROMPT = config_module.DEFAULT_THREAD_TITLE_PROMPT


def _base_env() -> dict[str, str]:
    return {
        "DATABASE_URL": "sqlite:///tmp.db",
        "AUTH_SECRET_KEY": "secret-key",
    }


def test_settings_openai_provider_requires_key() -> None:
    env = _base_env()
    env["OPENAI_API_KEY"] = "sk-test"

    settings = Settings.from_env(env)

    assert settings.model_provider == "openai"
    assert settings.model_api_key_env == "OPENAI_API_KEY"
    assert settings.model_api_key == "sk-test"
    assert settings.openai_api_key == "sk-test"
    assert settings.model_api_base == "https://api.openai.com"
    assert settings.thread_title_prompt == DEFAULT_THREAD_TITLE_PROMPT
    assert len(settings.model_providers) == 1
    assert settings.model_providers[0].provider == "openai"
    assert settings.model_providers[0].is_default is True
    assert settings.model_providers[0].id is None


def test_settings_openai_provider_missing_key_raises() -> None:
    env = _base_env()

    with pytest.raises(RuntimeError):
        Settings.from_env(env)


def test_settings_litellm_provider_uses_alternative_key() -> None:
    env = _base_env()
    env.update(
        {
            "MODEL_PROVIDER": "litellm",
            "LITELLM_API_BASE": "http://localhost:4000/",
            "LITELLM_API_KEY": "proxy-secret",
        }
    )

    settings = Settings.from_env(env)

    assert settings.model_provider == "litellm"
    assert settings.model_api_key_env == "LITELLM_API_KEY"
    assert settings.model_api_key == "proxy-secret"
    assert settings.openai_api_key is None
    assert settings.model_api_base == "http://localhost:4000"
    assert settings.chatkit_api_base == "http://localhost:4000"
    assert settings.thread_title_prompt == DEFAULT_THREAD_TITLE_PROMPT
    assert len(settings.model_providers) == 1
    assert settings.model_providers[0].provider == "litellm"
    assert settings.model_providers[0].api_key == "proxy-secret"
    assert settings.model_providers[0].id is None


def test_settings_thread_title_prompt_override() -> None:
    env = _base_env()
    env.update(
        {
            "OPENAI_API_KEY": "sk-test",
            "CHATKIT_THREAD_TITLE_PROMPT": "Titre personnalisé",
        }
    )

    settings = Settings.from_env(env)

    assert settings.thread_title_prompt == "Titre personnalisé"


def test_settings_default_sip_media_port() -> None:
    env = _base_env()
    env["OPENAI_API_KEY"] = "sk-test"

    settings = Settings.from_env(env)

    assert settings.sip_bind_host == config_module.DEFAULT_SIP_BIND_HOST
    assert settings.sip_bind_port == config_module.DEFAULT_SIP_BIND_PORT
    assert settings.sip_media_port == config_module.DEFAULT_SIP_MEDIA_PORT
    assert settings.sip_trunk_uri is None
    assert settings.sip_registrar is None
    assert settings.sip_contact_host is None
    assert settings.sip_contact_port is None
    assert settings.sip_contact_transport is None


def test_settings_custom_sip_media_port() -> None:
    env = _base_env()
    env.update(
        {
            "OPENAI_API_KEY": "sk-test",
            "SIP_MEDIA_PORT": "5008",
        }
    )

    settings = Settings.from_env(env)

    assert settings.sip_media_port == 5008
    assert settings.sip_contact_host is None
    assert settings.sip_contact_port is None
    assert settings.sip_contact_transport is None


def test_settings_custom_sip_contact_endpoint() -> None:
    env = _base_env()
    env.update(
        {
            "OPENAI_API_KEY": "sk-test",
            "SIP_CONTACT_HOST": "198.51.100.10",
            "SIP_CONTACT_PORT": "5070",
            "SIP_CONTACT_TRANSPORT": "UDP",
        }
    )

    settings = Settings.from_env(env)

    assert settings.sip_contact_host == "198.51.100.10"
    assert settings.sip_contact_port == 5070
    assert settings.sip_contact_transport == "UDP"


def test_settings_sip_transport_alias() -> None:
    env = _base_env()
    env.update(
        {
            "OPENAI_API_KEY": "sk-test",
            "SIP_TRANSPORT": "udp",
        }
    )

    settings = Settings.from_env(env)

    assert settings.sip_contact_transport == "udp"


def test_settings_sip_registrar_builds_trunk_uri() -> None:
    env = _base_env()
    env.update(
        {
            "OPENAI_API_KEY": "sk-test",
            "SIP_USERNAME": "102",
            "SIP_REGISTRAR": "192.168.1.155",  # sans schéma
        }
    )

    settings = Settings.from_env(env)

    assert settings.sip_trunk_uri == "sip:102@192.168.1.155"
    assert settings.sip_registrar == "192.168.1.155"


def test_set_runtime_settings_overrides_applies_custom_provider() -> None:
    config_module.get_settings.cache_clear()
    config_module.set_runtime_settings_overrides(None)
    env = _base_env()
    env["OPENAI_API_KEY"] = "sk-test"
    base_settings = Settings.from_env(env)
    assert base_settings.model_provider == "openai"
    assert base_settings.model_api_base == "https://api.openai.com"

    config_module.set_runtime_settings_overrides(
        {
            "model_provider": "litellm",
            "model_api_base": "http://localhost:4000",
            "model_api_key": "proxy-secret",
            "model_api_key_env": config_module.ADMIN_MODEL_API_KEY_ENV,
            "model_providers": (
                config_module.ModelProviderConfig(
                    provider="litellm",
                    api_base="http://localhost:4000",
                    api_key="proxy-secret",
                    is_default=True,
                    id="litellm-managed",
                ),
            ),
        }
    )
    overridden = config_module.get_settings()
    assert overridden.model_provider == "litellm"
    assert overridden.model_api_base == "http://localhost:4000"
    assert overridden.model_api_key == "proxy-secret"
    assert overridden.model_providers[0].provider == "litellm"
    assert overridden.model_providers[0].api_key == "proxy-secret"
    assert overridden.model_providers[0].id == "litellm-managed"

    config_module.set_runtime_settings_overrides(None)
