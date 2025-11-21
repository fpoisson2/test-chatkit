"""Construction de l'outil computer_use Agents."""

from __future__ import annotations

import contextvars
import logging
from typing import Any, Mapping

from agents.tool import ComputerTool

from ..computer.hosted_browser import HostedBrowser, HostedBrowserError

logger = logging.getLogger("chatkit.server")

__all__ = ["build_computer_use_tool", "cleanup_browser_cache", "set_current_thread_id"]

_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH = 1024
_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT = 768
_SUPPORTED_COMPUTER_ENVIRONMENTS = frozenset({"browser", "mac", "windows", "ubuntu"})

# Global cache for browser instances, keyed by thread_id
# Format: {thread_id: {cache_key: HostedBrowser}}
_browser_cache_by_thread: dict[str, dict[str, HostedBrowser]] = {}

# Context variable to pass thread_id from server to tool builders
_current_thread_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "computer_use_thread_id", default=None
)


def set_current_thread_id(thread_id: str | None) -> None:
    """
    Set the current thread ID for browser caching.

    This should be called at the beginning of workflow execution to enable
    browser persistence across multiple turns in the same conversation.
    """
    _current_thread_id.set(thread_id)


def _get_browser_cache(thread_id: str | None) -> dict[str, HostedBrowser]:
    """
    Get the browser cache for a specific thread ID.

    Each chat thread maintains its own browser cache, persisting across
    multiple requests/turns in the same conversation.
    """
    if not thread_id:
        # Fallback: temporary cache for requests without thread_id
        return {}

    if thread_id not in _browser_cache_by_thread:
        _browser_cache_by_thread[thread_id] = {}

    return _browser_cache_by_thread[thread_id]


def cleanup_browser_cache(thread_id: str | None = None) -> None:
    """
    Clean up cached browsers for a specific thread or all threads.

    Args:
        thread_id: If provided, only clean browsers for this thread.
                   If None, clean all threads' browsers.
    """
    if thread_id:
        cache = _browser_cache_by_thread.get(thread_id)
        if cache:
            logger.info(
                f"Nettoyage de {len(cache)} navigateur(s) pour le thread {thread_id}"
            )
            cache.clear()
            del _browser_cache_by_thread[thread_id]
    else:
        total = sum(len(cache) for cache in _browser_cache_by_thread.values())
        logger.info(f"Nettoyage de {total} navigateur(s) pour tous les threads")
        _browser_cache_by_thread.clear()


def _coerce_computer_dimension(value: Any, *, fallback: int) -> int:
    """Convertit une dimension (largeur ou hauteur) en entier positif raisonnable."""

    if isinstance(value, bool):
        return fallback

    candidate: int | None = None
    if isinstance(value, (int | float)) and not isinstance(value, bool):
        candidate = int(value)
    elif isinstance(value, str):
        stripped = value.strip()
        if stripped:
            try:
                candidate = int(float(stripped))
            except ValueError:
                candidate = None

    if candidate is None:
        return fallback

    if candidate <= 0:
        return fallback

    return min(candidate, 4096)


def build_computer_use_tool(payload: Any) -> ComputerTool | None:
    """Construit le ComputerTool permettant de piloter un navigateur hébergé."""

    config: Mapping[str, Any] | None = None
    if isinstance(payload, Mapping):
        candidate = payload.get("computer_use")
        if isinstance(candidate, Mapping):
            config = candidate
        elif payload.get("type") == "computer_use":
            config = payload

    if not isinstance(config, Mapping):
        return None

    width = _coerce_computer_dimension(
        config.get("display_width"), fallback=_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH
    )
    height = _coerce_computer_dimension(
        config.get("display_height"), fallback=_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT
    )

    environment_raw = config.get("environment")
    environment = (
        str(environment_raw).strip().lower() if isinstance(environment_raw, str) else ""
    )
    if environment not in _SUPPORTED_COMPUTER_ENVIRONMENTS:
        environment = "browser"

    initial_url = config.get("start_url") or config.get("url")
    start_url = None
    if isinstance(initial_url, str):
        stripped = initial_url.strip()
        if stripped:
            start_url = stripped

    # Extract thread_id from config if available, otherwise use context variable
    thread_id = config.get("thread_id")
    if isinstance(thread_id, str):
        thread_id = thread_id.strip() or None
    else:
        thread_id = None

    # Fallback to context variable if not in config
    if not thread_id:
        thread_id = _current_thread_id.get()

    # Log thread_id for debugging
    logger.info(
        f"build_computer_use_tool: thread_id={thread_id}, from_config={config.get('thread_id') is not None}"
    )
    logger.debug(
        f"Cache actuel contient {len(_browser_cache_by_thread)} threads: {list(_browser_cache_by_thread.keys())}"
    )

    # Create a cache key based on browser configuration
    # Each chat thread has its own isolated cache that persists across requests
    cache_key = f"{environment}:{width}x{height}"

    # Check if we already have a cached browser for this configuration
    # in the current chat thread
    cache = _get_browser_cache(thread_id)
    cached_browser = cache.get(cache_key)

    if cached_browser is not None:
        thread_info = f"thread={thread_id}" if thread_id else "sans thread_id"
        logger.info(
            f"Réutilisation du navigateur en cache ({thread_info}): {cache_key}"
        )
        computer = cached_browser
        # Don't navigate when reusing - keep browser at its current page
        logger.debug(
            "Navigateur réutilisé, conservation de la page actuelle"
        )
    else:
        # Create new browser instance for this context
        try:
            computer = HostedBrowser(
                width=width,
                height=height,
                environment=environment,
                start_url=start_url,
            )
            # Cache the browser for reuse within this chat thread (if thread_id provided)
            if thread_id:
                cache[cache_key] = computer
                logger.info(
                    f"Création et mise en cache d'un nouveau navigateur (thread={thread_id}): {cache_key}"
                )
            else:
                logger.info(
                    f"Création d'un nouveau navigateur (pas de cache, thread_id manquant): {cache_key}"
                )
        except HostedBrowserError as exc:  # pragma: no cover - dépend de l'environnement
            logger.warning("Impossible d'initialiser le navigateur hébergé : %s", exc)
            return None
        except Exception as exc:  # pragma: no cover - robuste face aux erreurs inattendues
            logger.exception(
                "Erreur inattendue lors de la création du navigateur hébergé",
                exc_info=exc,
            )
            return None

    def _acknowledge_safety_check(data: Any) -> bool:
        safety = getattr(data, "safety_check", None)
        if safety is not None:
            logger.warning(
                "Avertissement de sécurité du navigateur hébergé (%s): %s",
                getattr(safety, "code", "inconnu"),
                getattr(safety, "message", ""),
            )
        return True

    return ComputerTool(computer=computer, on_safety_check=_acknowledge_safety_check)
