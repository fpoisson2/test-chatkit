"""Construction de l'outil computer_use Agents."""

from __future__ import annotations

import logging
import threading
from typing import Any, Mapping

from agents.tool import ComputerTool

from ..computer.hosted_browser import HostedBrowser, HostedBrowserError

logger = logging.getLogger("chatkit.server")

__all__ = ["build_computer_use_tool", "cleanup_browser_cache"]

_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH = 1024
_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT = 768
_SUPPORTED_COMPUTER_ENVIRONMENTS = frozenset({"browser", "mac", "windows", "ubuntu"})

# Thread-local storage for cached browser instances
_thread_local = threading.local()


def _get_browser_cache() -> dict[str, HostedBrowser]:
    """Get the browser cache for this thread/request."""
    if not hasattr(_thread_local, "browser_cache"):
        _thread_local.browser_cache = {}
    return _thread_local.browser_cache


def cleanup_browser_cache() -> None:
    """Clean up all cached browsers for this thread/request."""
    cache = _get_browser_cache()
    if cache:
        logger.info(f"Cleaning up {len(cache)} cached browser(s)")
        for key, browser in cache.items():
            try:
                # Browser cleanup will be handled by driver close
                logger.debug(f"Removed cached browser: {key}")
            except Exception as exc:
                logger.warning(f"Error cleaning up cached browser {key}: {exc}")
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
    # Note: We don't include start_url in the cache key because we want to reuse
    # the browser even if the URL changes - navigation can be done separately
    cache_key = f"{environment}:{width}x{height}"

    # Check if we already have a cached browser with this configuration
    cache = _get_browser_cache()
    cached_browser = cache.get(cache_key)

    if cached_browser is not None:
        logger.info(
            f"Réutilisation du navigateur en cache pour la configuration: {cache_key}"
        )
        computer = cached_browser
        # Navigate to start_url if provided, even when reusing cached browser
        if start_url:
            computer.set_pending_navigation(start_url)
            logger.info(
                f"URL initiale configurée pour navigation: {start_url}"
            )
    else:
        # Create new browser instance
        try:
            computer = HostedBrowser(
                width=width,
                height=height,
                environment=environment,
                start_url=start_url,
            )
            # Cache the browser for reuse
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
