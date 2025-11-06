"""Configuration utilitaire pour l'adaptateur PJSUA."""

from __future__ import annotations

import logging
import os
from collections.abc import MutableMapping
from dataclasses import dataclass

__all__ = [
    "RTPPortDefaults",
    "ensure_environment_overrides",
    "get_default_ports",
]


logger = logging.getLogger("chatkit.telephony.pjsua")


@dataclass(frozen=True)
class RTPPortDefaults:
    """Valeurs par défaut pour les ports RTP utilisés par PJSUA."""

    start: int
    range: int


_DEFAULT_PORTS = RTPPortDefaults(start=10000, range=10000)


def get_default_ports() -> RTPPortDefaults:
    """Retourne les valeurs par défaut pour la configuration RTP."""

    return _DEFAULT_PORTS


def ensure_environment_overrides(
    env: MutableMapping[str, str] | None = None,
    *,
    logger: logging.Logger | None = None,
) -> RTPPortDefaults:
    """Garantit que les variables d'environnement nécessaires sont définies.

    Args:
        env: Mapping cible (par défaut ``os.environ``).
        logger: Logger pour signaler les modifications appliquées.

    Returns:
        ``RTPPortDefaults`` représentant les valeurs effectives.
    """

    if env is None:
        env = os.environ

    log = logger or globals().get("logger") or logging.getLogger(__name__)
    defaults = get_default_ports()

    start_value = env.get("PJSUA_RTP_PORT_START")
    if not start_value:
        env["PJSUA_RTP_PORT_START"] = str(defaults.start)
        log.info(
            "🔧 WORKAROUND: Définition de PJSUA_RTP_PORT_START=%s via env var",
            defaults.start,
        )
        start_value = env["PJSUA_RTP_PORT_START"]

    range_value = env.get("PJSUA_RTP_PORT_RANGE")
    if not range_value:
        env["PJSUA_RTP_PORT_RANGE"] = str(defaults.range)
        log.info(
            "🔧 WORKAROUND: Définition de PJSUA_RTP_PORT_RANGE=%s via env var",
            defaults.range,
        )
        range_value = env["PJSUA_RTP_PORT_RANGE"]

    try:
        start_int = int(start_value)
    except (TypeError, ValueError):
        start_int = defaults.start
        env["PJSUA_RTP_PORT_START"] = str(start_int)
        log.info(
            "🔧 WORKAROUND: Normalisation de PJSUA_RTP_PORT_START=%s via env var",
            start_int,
        )

    try:
        range_int = int(range_value)
    except (TypeError, ValueError):
        range_int = defaults.range
        env["PJSUA_RTP_PORT_RANGE"] = str(range_int)
        log.info(
            "🔧 WORKAROUND: Normalisation de PJSUA_RTP_PORT_RANGE=%s via env var",
            range_int,
        )

    return RTPPortDefaults(start=start_int, range=range_int)
