"""Construction de l'outil computer_use Agents."""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Mapping
from weakref import WeakKeyDictionary

from agents.tool import ComputerTool

from ..computer.hosted_browser import HostedBrowser, HostedBrowserError
from ..computer.hosted_ssh import HostedSSH, HostedSSHError, SSHConfig

logger = logging.getLogger("chatkit.server")

__all__ = ["build_computer_use_tool", "cleanup_browser_cache", "get_thread_browsers", "set_current_thread_id"]

_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH = 1024
_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT = 768
_SUPPORTED_COMPUTER_ENVIRONMENTS = frozenset({"browser", "mac", "windows", "ubuntu", "ssh"})

# Global cache for browser instances, keyed by thread_id
# Format: {thread_id: {cache_key: HostedBrowser}}
_browser_cache_by_thread: dict[str, dict[str, HostedBrowser]] = {}

# Map asyncio tasks to their thread_id (using WeakKeyDictionary for auto-cleanup)
# This is more reliable than contextvars because each async task has a unique ID
# and there's no inheritance/copying issues
_thread_id_by_task: WeakKeyDictionary[asyncio.Task, str] = WeakKeyDictionary()


def set_current_thread_id(thread_id: str | None) -> None:
    """
    Set the current thread ID for browser caching.

    This should be called at the beginning of workflow execution to enable
    browser persistence across multiple turns in the same conversation.

    Uses asyncio.current_task() instead of contextvars to avoid context
    inheritance issues between different chat threads.
    """
    task = asyncio.current_task()
    if task and thread_id:
        _thread_id_by_task[task] = thread_id
        logger.info(
            f"🔵 NOUVEAU MAPPING: thread_id={thread_id} → task_id={id(task)} "
            f"| Total tâches actives: {len(_thread_id_by_task)}"
        )


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


def get_thread_browsers(thread_id: str) -> dict[str, HostedBrowser]:
    """
    Get all cached browsers for a specific thread.

    Args:
        thread_id: The thread ID to get browsers for.

    Returns:
        Dict mapping cache_key to HostedBrowser instances.
    """
    return _browser_cache_by_thread.get(thread_id, {})


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

    # Fallback to task mapping if not in config
    if not thread_id:
        task = asyncio.current_task()
        if task:
            thread_id = _thread_id_by_task.get(task)
            logger.info(
                f"🔍 Récupération thread_id depuis mapping: task_id={id(task)} → thread_id={thread_id}"
            )
        else:
            logger.warning("⚠️ Aucune tâche asyncio actuelle trouvée!")

    # Log thread_id for debugging
    logger.info(
        f"🛠️ build_computer_use_tool: thread_id={thread_id}, "
        f"from_config={config.get('thread_id') is not None}, "
        f"tâches actives={len(_thread_id_by_task)}"
    )
    logger.info(
        f"📦 Cache global: {len(_browser_cache_by_thread)} threads → {list(_browser_cache_by_thread.keys())}"
    )

    # Handle SSH environment separately
    if environment == "ssh":
        # Extract SSH-specific configuration
        ssh_host = config.get("ssh_host")
        if not isinstance(ssh_host, str) or not ssh_host.strip():
            logger.warning("Configuration SSH manquante: ssh_host est requis")
            return None

        ssh_port_raw = config.get("ssh_port", 22)
        ssh_port = 22
        if isinstance(ssh_port_raw, int):
            ssh_port = ssh_port_raw
        elif isinstance(ssh_port_raw, str):
            try:
                ssh_port = int(ssh_port_raw)
            except ValueError:
                ssh_port = 22

        ssh_username = config.get("ssh_username", "root")
        if not isinstance(ssh_username, str):
            ssh_username = "root"

        ssh_password = config.get("ssh_password")
        if not isinstance(ssh_password, str) or not ssh_password.strip():
            ssh_password = None

        ssh_private_key = config.get("ssh_private_key")
        if not isinstance(ssh_private_key, str) or not ssh_private_key.strip():
            ssh_private_key = None

        if not ssh_password and not ssh_private_key:
            logger.warning(
                "Configuration SSH incomplète: un mot de passe ou une clé privée est requis"
            )
            return None

        ssh_config = SSHConfig(
            host=ssh_host.strip(),
            port=ssh_port,
            username=ssh_username.strip() if ssh_username else "root",
            password=ssh_password.strip() if ssh_password else None,
            private_key=ssh_private_key.strip() if ssh_private_key else None,
        )

        # Create SSH cache key
        cache_key = f"ssh:{ssh_config.host}:{ssh_config.port}:{ssh_config.username}"
        cache = _get_browser_cache(thread_id)
        cached_ssh = cache.get(cache_key)

        if cached_ssh is not None and isinstance(cached_ssh, HostedSSH):
            thread_info = f"thread={thread_id}" if thread_id else "sans thread_id"
            logger.info(
                f"♻️ RÉUTILISATION connexion SSH en cache ({thread_info}): {cache_key}"
            )
            computer = cached_ssh
        else:
            try:
                computer = HostedSSH(
                    width=width,
                    height=height,
                    config=ssh_config,
                )
                if thread_id:
                    cache[cache_key] = computer  # type: ignore[assignment]
                    logger.info(
                        f"🆕 CRÉATION nouvelle connexion SSH (thread={thread_id}): {cache_key}"
                    )
                else:
                    logger.info(
                        f"⚠️ CRÉATION connexion SSH SANS CACHE (thread_id manquant): {cache_key}"
                    )
            except HostedSSHError as exc:
                logger.warning("Impossible d'initialiser la connexion SSH : %s", exc)
                return None
            except Exception as exc:
                logger.exception(
                    "Erreur inattendue lors de la création de la connexion SSH",
                    exc_info=exc,
                )
                return None
    else:
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
                f"♻️ RÉUTILISATION navigateur en cache ({thread_info}): {cache_key}"
            )
            computer = cached_browser
            # Don't navigate when reusing - keep browser at its current page
            logger.info(
                f"✓ Navigateur réutilisé pour thread {thread_id}, conservation de la page actuelle"
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
                        f"🆕 CRÉATION nouveau navigateur (thread={thread_id}): {cache_key} | "
                        f"Mise en cache pour réutilisation future"
                    )
                else:
                    logger.info(
                        f"⚠️ CRÉATION navigateur SANS CACHE (thread_id manquant): {cache_key}"
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
