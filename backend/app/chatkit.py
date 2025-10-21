"""Point d'entrée historique pour le backend ChatKit."""

from __future__ import annotations

from .chatkit_core import *  # noqa: F401,F403 - réexporte l'API publique
from .chatkit_core import __all__ as _core_all
from .chatkit_core.workflow_runner import _build_thread_title_agent
from backend.app.chatkit_server.context import (
    AutoStartConfiguration,
    ChatKitRequestContext,
)
from backend.app.chatkit_server.server import (
    DemoChatKitServer,
    ImageAwareThreadItemConverter,
)
from .chatkit_store import PostgresChatKitStore
from .config import Settings, get_settings
from .database import SessionLocal

__all__ = list(_core_all) + [
    "AutoStartConfiguration",
    "ChatKitRequestContext",
    "DemoChatKitServer",
    "ImageAwareThreadItemConverter",
    "PostgresChatKitStore",
    "SessionLocal",
    "Settings",
    "_build_thread_title_agent",
    "get_chatkit_server",
]

_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""

    global _server
    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
