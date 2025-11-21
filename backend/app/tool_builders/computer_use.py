"""Construction de l'outil computer_use Agents."""

from __future__ import annotations

import contextvars
import logging
from typing import Any, Mapping

from agents.tool import ComputerTool

from ..computer.hosted_browser import HostedBrowser, HostedBrowserError

logger = logging.getLogger("chatkit.server")

__all__ = ["build_computer_use_tool", "cleanup_browser_cache"]

_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH = 1024
_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT = 768
_SUPPORTED_COMPUTER_ENVIRONMENTS = frozenset({"browser", "mac", "windows", "ubuntu"})

# Context-local storage for browser instances - each async context (workflow/chat thread)
# gets its own isolated cache
_browser_cache: contextvars.ContextVar[dict[str, HostedBrowser]] = contextvars.ContextVar(
    "computer_use_browser_cache", default=None
)


def _get_browser_cache() -> dict[str, HostedBrowser]:
    """Get the browser cache for the current async context (workflow/chat thread)."""
    cache = _browser_cache.get()
    if cache is None:
        cache = {}
        _browser_cache.set(cache)
    return cache


def cleanup_browser_cache() -> None:
    """
    Clean up all cached browsers for the current async context.

    Each workflow/chat thread has its own isolated browser cache thanks to
    contextvars. This function clears the cache for the current context only.
    """
    cache = _browser_cache.get()
    if cache:
        logger.info(f"Nettoyage de {len(cache)} navigateur(s) en cache pour ce contexte")
        for key, browser in list(cache.items()):
            try:
                logger.debug(f"Suppression du navigateur en cache: {key}")
            except Exception as exc:
                logger.warning(f"Erreur lors du nettoyage du navigateur {key}: {exc}")
        cache.clear()


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

    # Create a cache key based on browser configuration
    # Each async context (workflow/chat thread) has its own isolated cache
    cache_key = f"{environment}:{width}x{height}"

    # Check if we already have a cached browser for this configuration
    # in the current async context
    cache = _get_browser_cache()
    cached_browser = cache.get(cache_key)

    if cached_browser is not None:
        logger.info(
            f"Réutilisation du navigateur en cache (contexte actuel): {cache_key}"
        )
        computer = cached_browser
        # Navigate to start_url if provided, even when reusing cached browser
        if start_url:
            computer.set_pending_navigation(start_url)
            logger.info(
                f"URL initiale configurée pour navigation: {start_url}"
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
            # Cache the browser for reuse within this async context
            cache[cache_key] = computer
            logger.info(
                f"Création et mise en cache d'un nouveau navigateur: {cache_key}"
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
