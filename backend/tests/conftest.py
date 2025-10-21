"""Configuration Pytest commune pour les tests backend."""

from __future__ import annotations

import os


def pytest_configure() -> None:
    """Définit les variables d'environnement minimales pour les tests."""

    defaults = {
        "DATABASE_URL": "sqlite:///./chatkit-tests.db",
        "OPENAI_API_KEY": "sk-test",  # Clé fictive adaptée aux tests unitaires
        "AUTH_SECRET_KEY": "secret-key",
    }

    for name, value in defaults.items():
        os.environ.setdefault(name, value)
