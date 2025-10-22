"""Gestion centralisée des fournisseurs de modèles."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from .litellm import configure_litellm_client
from .openai import configure_openai_client

if TYPE_CHECKING:  # pragma: no cover - uniquement pour l'analyse statique
    from ..config import Settings

logger = logging.getLogger("chatkit.model_providers")

__all__ = [
    "configure_model_provider",
    "configure_openai_client",
    "configure_litellm_client",
]


def configure_model_provider(settings: Settings) -> None:
    """Configure le client du SDK Agents selon le fournisseur choisi."""

    provider = (settings.model_provider or "").lower()
    logger.info("Configuration du fournisseur de modèles : %s", provider or "<inconnu>")

    if provider == "litellm":
        configure_litellm_client(settings)
    elif provider == "openai":
        configure_openai_client(settings)
    else:
        logger.warning(
            "Fournisseur de modèles %s non pris en charge pour la "
            "configuration automatique.",
            provider,
        )
