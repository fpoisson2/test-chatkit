"""Utilitaires communs pour la configuration des fournisseurs de modèles."""

from __future__ import annotations


def normalize_api_base(base_url: str) -> str:
    """Retourne l'URL de base normalisée vers le endpoint `/v1`."""

    sanitized = base_url.rstrip("/")
    if sanitized.endswith("/v1"):
        return sanitized
    return f"{sanitized}/v1"
