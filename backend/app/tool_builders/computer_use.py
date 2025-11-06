"""Construction de l'outil computer_use Agents."""

from __future__ import annotations

import logging
from typing import Any, Mapping

from agents.tool import ComputerTool

from ..computer.hosted_browser import HostedBrowser, HostedBrowserError

logger = logging.getLogger("chatkit.server")

__all__ = ["build_computer_use_tool"]

_DEFAULT_COMPUTER_USE_DISPLAY_WIDTH = 1024
_DEFAULT_COMPUTER_USE_DISPLAY_HEIGHT = 768
_SUPPORTED_COMPUTER_ENVIRONMENTS = frozenset({"browser", "mac", "windows", "ubuntu"})


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

    try:
        computer = HostedBrowser(
            width=width,
            height=height,
            environment=environment,
            start_url=start_url,
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
