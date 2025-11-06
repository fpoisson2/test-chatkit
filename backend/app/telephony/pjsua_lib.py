"""Shared utilities for working with the optional :mod:`pjsua2` binding."""

from __future__ import annotations

import logging

logger = logging.getLogger("chatkit.telephony.pjsua")
logger.setLevel(logging.INFO)

PJSUA_AVAILABLE = False
try:  # pragma: no cover - executed only when pjsua2 is installed
    import pjsua2 as pj

    PJSUA_AVAILABLE = True
    logger.info("PJSUA2 chargé avec succès")
except ImportError as error:  # pragma: no cover - executed in test environments
    logger.warning("pjsua2 n'est pas disponible: %s", error)
    pj = None  # type: ignore[assignment]

__all__ = ["PJSUA_AVAILABLE", "pj", "logger"]
