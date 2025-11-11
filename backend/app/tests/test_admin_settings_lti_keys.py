from __future__ import annotations

from pathlib import Path

import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa

from backend.app import admin_settings
from backend.app.config import (
    DEFAULT_LTI_PRIVATE_KEY_FILENAME,
    DEFAULT_LTI_PUBLIC_KEY_FILENAME,
    get_settings,
    set_runtime_settings_overrides,
)


def _generate_private_key_pem() -> str:
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    return (
        key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        )
        .decode("utf-8")
        .strip()
    )


def test_serialize_lti_tool_settings_generates_managed_files(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("DATABASE_URL", "sqlite:///:memory:")
    monkeypatch.setenv("AUTH_SECRET_KEY", "secret-key")
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    monkeypatch.setenv("CHATKIT_LTI_KEYS_DIR", str(tmp_path))
    monkeypatch.delenv("LTI_TOOL_PRIVATE_KEY_PATH", raising=False)
    monkeypatch.delenv("LTI_TOOL_PUBLIC_KEY_PATH", raising=False)

    private_pem = _generate_private_key_pem()
    monkeypatch.setenv("LTI_TOOL_PRIVATE_KEY", private_pem)

    set_runtime_settings_overrides(None)
    get_settings.cache_clear()

    try:
        payload = admin_settings.serialize_lti_tool_settings(None)
    finally:
        get_settings.cache_clear()
        set_runtime_settings_overrides(None)

    expected_private_path = tmp_path / DEFAULT_LTI_PRIVATE_KEY_FILENAME
    expected_public_path = tmp_path / DEFAULT_LTI_PUBLIC_KEY_FILENAME

    assert payload["private_key_path"] == str(expected_private_path)
    assert payload["public_key_path"] == str(expected_public_path)

    assert expected_private_path.exists()
    saved_private = expected_private_path.read_text(encoding="utf-8").strip()
    assert saved_private == private_pem

    assert expected_public_path.exists()
    saved_public = expected_public_path.read_text(encoding="utf-8")
    assert payload["public_key_pem"] == saved_public
    assert payload["public_key_last_updated_at"] is not None
