from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]

from .config import get_settings

__path__ = [str((Path(__file__).resolve().parent / "chatkit").resolve())]


logger = logging.getLogger("chatkit.server")


# ---------------------------------------------------------------------------
# Définition du workflow local exécuté par DemoChatKitServer
# ---------------------------------------------------------------------------

if TYPE_CHECKING:
    from .chatkit_server.server import DemoChatKitServer


_server: DemoChatKitServer | None = None


def get_chatkit_server() -> DemoChatKitServer:
    """Retourne l'instance unique du serveur ChatKit."""
    global _server
    from .chatkit_server.server import DemoChatKitServer

    if _server is None:
        _server = DemoChatKitServer(get_settings())
    return _server
