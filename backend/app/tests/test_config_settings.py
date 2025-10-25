from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

ROOT_DIR = Path(__file__).resolve().parents[2]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

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

    assert settings.sip_media_port == config_module.DEFAULT_SIP_MEDIA_PORT


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
