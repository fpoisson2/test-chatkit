from __future__ import annotations

import logging
from pathlib import Path
from typing import TYPE_CHECKING

__path__ = [str((Path(__file__).resolve().parent / "chatkit").resolve())]
if __spec__ is not None:  # pragma: no branch - défensif, dépend du chargement du module
    __spec__.submodule_search_locations = __path__

try:  # pragma: no cover - dépend de la version du SDK Agents installée
    from chatkit.agents import stream_widget as _sdk_stream_widget
except ImportError:  # pragma: no cover - compatibilité avec les anciennes versions
    _sdk_stream_widget = None  # type: ignore[assignment]

from .chatkit_server.context import ChatKitRequestContext
from .config import get_settings
from .workflows.executor import (
    WorkflowExecutionError,
    WorkflowInput,
    WorkflowRunSummary,
    WorkflowStepStreamUpdate,
    WorkflowStepSummary,
    run_workflow,
)

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


__all__ = [
    "ChatKitRequestContext",
    "WorkflowExecutionError",
    "WorkflowInput",
    "WorkflowRunSummary",
    "WorkflowStepStreamUpdate",
    "WorkflowStepSummary",
    "get_chatkit_server",
    "run_workflow",
]
