"""Configuration du client LiteLLM."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING

from agents import set_default_openai_client
from openai import AsyncOpenAI

try:
    import litellm
except ImportError:
    litellm = None

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

    # Activer drop_params pour ignorer automatiquement les paramètres non supportés
    # par certains fournisseurs (ex: reasoning_effort sur Groq)
    if litellm is not None:
        litellm.drop_params = True
        logger.debug("LiteLLM drop_params activé")

    if settings.litellm_log_level is not None:
        # Configure les loggers Python standard pour LiteLLM
        litellm_logger = logging.getLogger("litellm")
        litellm_logger.setLevel(settings.litellm_log_level)

        # Configure aussi tous les loggers enfants existants
        for name in list(logging.Logger.manager.loggerDict.keys()):
            if name.startswith("litellm") or name.startswith("LiteLLM"):
                child_logger = logging.getLogger(name)
                child_logger.setLevel(settings.litellm_log_level)

        # Configure l'API native de LiteLLM si disponible
        if litellm is not None:
            # Désactive les logs debug verbeux de LiteLLM
            if settings.litellm_log_level >= logging.INFO:
                litellm.suppress_debug_info = True
                # Aussi définir set_verbose à False si le niveau est INFO ou plus
                if hasattr(litellm, 'set_verbose'):
                    litellm.set_verbose = False
            else:
                litellm.suppress_debug_info = False
                if hasattr(litellm, 'set_verbose'):
                    litellm.set_verbose = True

        logger.info(
            "Niveau de log LiteLLM configuré sur %s",
            logging.getLevelName(settings.litellm_log_level),
        )
    logger.debug("Client LiteLLM configuré sur %s", base_url)
