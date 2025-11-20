"""Configuration centralisée du logging avec structlog.

Ce module configure le logging structuré pour toute l'application, offrant :
- Sortie JSON pour faciliter le parsing et l'analyse
- Format console coloré pour le développement (avec support Docker)
- Contexte enrichi (timestamps ISO, request_id, user_id, etc.)
- Interception complète des logs standard Python (pas de duplication)
- Support des environnements dev/prod avec formats différents
"""

from __future__ import annotations

import logging
import os
import sys
from typing import Any

import structlog


def configure_logging(
    log_level: str | None = None,
    litellm_log_level: str | None = None,
    use_json_logs: bool = True,
) -> None:
    """Configure le système de logging structuré pour l'application.

    Args:
        log_level: Niveau de log global (DEBUG, INFO, WARNING, ERROR, CRITICAL).
                   Si None, utilise la variable d'environnement LOG_LEVEL (défaut: INFO).
        litellm_log_level: Niveau de log spécifique pour LiteLLM.
                           Si None, utilise la variable d'environnement LITELLM_LOG_LEVEL.
        use_json_logs: Si True, utilise le format JSON. Si False, utilise un format
                       lisible pour le développement. Par défaut détecté via LOG_FORMAT.
    """
    # Déterminer le niveau de log
    if log_level is None:
        log_level = os.getenv("LOG_LEVEL", "INFO").upper()

    log_level_int = getattr(logging, log_level, logging.INFO)

    # Déterminer le format de sortie
    log_format = os.getenv("LOG_FORMAT", "").lower()
    if log_format == "json":
        use_json_logs = True
    elif log_format == "console":
        use_json_logs = False
    # Sinon, utilise la valeur du paramètre (défaut: True)

    # Processeurs pour structlog (utilisés par les logs structlog directs)
    structlog_processors: list[Any] = [
        # Ajoute le contexte des variables contextuelles (request_id, user_id, etc.)
        structlog.contextvars.merge_contextvars,
        # Ajoute le nom du logger
        structlog.stdlib.add_logger_name,
        # Ajoute le niveau de log
        structlog.stdlib.add_log_level,
        # Ajoute le timestamp
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        # Prépare pour le traitement par ProcessorFormatter
        structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
    ]

    # Processeurs de rendu (utilisés par ProcessorFormatter pour les logs standard)
    if use_json_logs:
        # Format JSON pour production
        formatter_processors: list[Any] = [
            # Convertit les logs de style Python (logger.info("msg %s", arg)) en format structlog
            structlog.stdlib.render_to_log_kwargs,
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.format_exc_info,
            structlog.processors.JSONRenderer(),
        ]
    else:
        # Format console coloré pour développement
        formatter_processors = [
            # Convertit les logs de style Python (logger.info("msg %s", arg)) en format structlog
            structlog.stdlib.render_to_log_kwargs,
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.dev.set_exc_info,
            # Force les couleurs même en Docker
            structlog.dev.ConsoleRenderer(colors=True, force_colors=True),
        ]

    # Créer le formatter structlog pour intercepter les logs standard
    formatter = structlog.stdlib.ProcessorFormatter(
        processors=formatter_processors,
        foreign_pre_chain=structlog_processors,
    )

    # Configurer le root logger pour utiliser structlog
    root_logger = logging.getLogger()
    root_logger.handlers.clear()  # Supprimer les handlers existants

    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)
    root_logger.addHandler(handler)
    root_logger.setLevel(log_level_int)

    # Configuration de structlog
    structlog.configure(
        processors=structlog_processors,
        # Wrapper pour filtrer par niveau de log
        wrapper_class=structlog.make_filtering_bound_logger(log_level_int),
        # Utilise dict pour le contexte (plus performant que OrderedDict)
        context_class=dict,
        # Intégration avec le logging standard de Python
        logger_factory=structlog.stdlib.LoggerFactory(),
        # Cache les loggers pour améliorer les performances
        cache_logger_on_first_use=True,
    )

    # Configurer les niveaux de log pour les librairies tierces bruyantes
    _configure_third_party_loggers()

    # Configurer LiteLLM si nécessaire
    if litellm_log_level is None:
        litellm_log_level = os.getenv("LITELLM_LOG_LEVEL")

    if litellm_log_level:
        _configure_litellm(litellm_log_level)

    # Log de confirmation
    logger = structlog.get_logger("chatkit.logging")
    logger.info(
        "logging_configured",
        log_level=log_level,
        format="json" if use_json_logs else "console",
        litellm_configured=bool(litellm_log_level),
    )


def _configure_third_party_loggers() -> None:
    """Configure les niveaux de log pour les librairies tierces bruyantes."""

    # HTTP clients (réduire la verbosité)
    logging.getLogger("httpcore").setLevel(logging.INFO)
    logging.getLogger("httpx").setLevel(logging.INFO)

    # Filtre pour supprimer les erreurs de cancel scope du SDK OpenAI
    # Ces erreurs sont internes au SDK et n'affectent pas le fonctionnement
    class OpenAICancelScopeFilter(logging.Filter):
        """Filtre les erreurs de cancel scope du SDK OpenAI lors du nettoyage."""

        def filter(self, record: logging.LogRecord) -> bool:
            if record.levelno == logging.ERROR:
                message = record.getMessage()
                if "cancel scope" in message.lower() and "different task" in message.lower():
                    return False
            return True

    # Appliquer le filtre au logger openai.agents
    openai_agents_logger = logging.getLogger("openai.agents")
    openai_agents_logger.addFilter(OpenAICancelScopeFilter())


def _configure_litellm(litellm_log_level_str: str) -> None:
    """Configure spécifiquement les loggers LiteLLM.

    Args:
        litellm_log_level_str: Niveau de log pour LiteLLM (DEBUG, INFO, etc.)
    """
    litellm_log_level = getattr(logging, litellm_log_level_str.upper(), logging.INFO)

    # Configure tous les loggers LiteLLM
    logging.getLogger("litellm").setLevel(litellm_log_level)
    logging.getLogger("LiteLLM").setLevel(litellm_log_level)

    # Configure l'API native de LiteLLM pour supprimer les logs debug si nécessaire
    try:
        import litellm

        if litellm_log_level >= logging.INFO:
            litellm.suppress_debug_info = True
            if hasattr(litellm, "set_verbose"):
                litellm.set_verbose = False
        else:
            litellm.suppress_debug_info = False
            if hasattr(litellm, "set_verbose"):
                litellm.set_verbose = True
    except ImportError:
        # LiteLLM n'est pas installé, pas grave
        pass


# Helpers pour ajouter du contexte aux logs


def bind_request_context(request_id: str, **kwargs: Any) -> None:
    """Ajoute un contexte de requête aux logs.

    Args:
        request_id: Identifiant unique de la requête
        **kwargs: Autres données contextuelles (user_id, session_id, etc.)
    """
    structlog.contextvars.bind_contextvars(request_id=request_id, **kwargs)


def unbind_request_context() -> None:
    """Retire le contexte de requête des logs."""
    structlog.contextvars.clear_contextvars()


def get_logger(name: str | None = None) -> structlog.stdlib.BoundLogger:
    """Retourne un logger structlog.

    Args:
        name: Nom du logger (généralement __name__). Si None, utilise le nom par défaut.

    Returns:
        Un logger structlog configuré.

    Example:
        >>> logger = get_logger(__name__)
        >>> logger.info("user_login", user_id=123, email="user@example.com")
    """
    return structlog.get_logger(name)
