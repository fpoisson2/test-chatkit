"""Helpers for registering FastAPI startup events."""

from .main import *  # noqa: F401,F403
from .main import (
    configure_sip_layer,
    register_database_startup,
    register_startup_events,
    register_telephony_events,
)

__all__ = [
    "configure_sip_layer",
    "register_database_startup",
    "register_startup_events",
    "register_telephony_events",
]
