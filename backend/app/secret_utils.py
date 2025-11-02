from __future__ import annotations

import base64
import hashlib
import logging
import os
from functools import lru_cache

from cryptography.fernet import Fernet, InvalidToken

logger = logging.getLogger("chatkit.secrets")


class SecretKeyUnavailableError(RuntimeError):
    """Raised when no suitable secret key is configured for encryption."""


@lru_cache(maxsize=1)
def _get_cipher() -> Fernet:
    secret = os.environ.get("APP_SETTINGS_SECRET_KEY") or os.environ.get(
        "AUTH_SECRET_KEY"
    )
    if not secret:
        raise SecretKeyUnavailableError(
            "APP_SETTINGS_SECRET_KEY doit être défini pour chiffrer les données."
        )

    digest = hashlib.sha256(secret.encode("utf-8")).digest()
    key = base64.urlsafe_b64encode(digest)
    return Fernet(key)


def ensure_secret_key_available() -> None:
    """Ensure the encryption key is available."""

    _get_cipher()


def encrypt_secret(value: str) -> str:
    """Encrypt a sensitive value with the application key."""

    ensure_secret_key_available()
    return _get_cipher().encrypt(value.encode("utf-8")).decode("utf-8")


def decrypt_secret(value: str | None) -> str | None:
    """Decrypt a previously encrypted secret value."""

    if not value:
        return None

    try:
        decrypted = _get_cipher().decrypt(value.encode("utf-8"))
    except InvalidToken:
        logger.warning(
            "Secret illisible : la clé de chiffrement a peut-être changé."
        )
        return None
    return decrypted.decode("utf-8")


def mask_secret(value: str, max_length: int = 128) -> str:
    """Produce a masked representation of a secret for display purposes.

    Args:
        value: The secret value to mask
        max_length: Maximum length of the masked output (default: 128)

    Returns:
        A masked string showing bullets and the last 4 characters
    """

    trimmed = value.strip()
    if not trimmed:
        return ""
    if len(trimmed) <= 4:
        return "•" * min(len(trimmed), max_length)

    # Show last 4 characters, and fill the rest with bullets up to max_length
    suffix = trimmed[-4:]
    max_bullets = max_length - len(suffix)
    # Use reasonable number of bullets (min of actual length - 4, or max allowed)
    num_bullets = min(len(trimmed) - 4, max_bullets)

    return "•" * num_bullets + suffix


__all__ = [
    "SecretKeyUnavailableError",
    "ensure_secret_key_available",
    "encrypt_secret",
    "decrypt_secret",
    "mask_secret",
]
