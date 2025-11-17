"""Configuration du client LiteLLM."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents import set_default_openai_client
from openai import AsyncOpenAI

from ._shared import normalize_api_base

if TYPE_CHECKING:  # pragma: no cover - uniquement pour l'analyse statique
    from ..config import Settings

logger = logging.getLogger("chatkit.model_providers.litellm")


def configure_litellm_client(settings: Settings) -> None:
    """Configure le client AsyncOpenAI pour LiteLLM et l'enregistre dans le SDK."""

    api_key = settings.model_api_key
    if not api_key:
        raise RuntimeError(
            "Une clé API valide est requise pour initialiser le client LiteLLM."
        )

    base_url = normalize_api_base(settings.model_api_base)
    client = AsyncOpenAI(api_key=api_key, base_url=base_url)
    set_default_openai_client(client)
    if settings.litellm_log_level is not None:
        # Configure le logger principal de litellm
        litellm_logger = logging.getLogger("litellm")
        litellm_logger.setLevel(settings.litellm_log_level)

        # Empêche la propagation pour éviter les logs dupliqués
        litellm_logger.propagate = True

        # Configure aussi tous les loggers enfants existants et futurs
        for name in list(logging.Logger.manager.loggerDict.keys()):
            if name.startswith("litellm") or name.startswith("LiteLLM"):
                child_logger = logging.getLogger(name)
                child_logger.setLevel(settings.litellm_log_level)
                child_logger.propagate = True

        logger.info(
            "Niveau de log LiteLLM configuré sur %s",
            logging.getLevelName(settings.litellm_log_level),
        )
    logger.debug("Client LiteLLM configuré sur %s", base_url)
