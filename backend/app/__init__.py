"""Initialisation du backend FastAPI."""

# ⚠️ CONFIGURATION LOGGING - DOIT ÊTRE EN PREMIER ⚠️
# Configurer le logging AVANT tous les autres imports pour éviter les logs parasites
import os
import logging
import sys

if os.getenv("CHATKIT_CALL_TRACKER_ONLY", "false").lower() in ("true", "1", "yes"):
    # Ne montrer QUE les logs d'appels structurés
    formatter = logging.Formatter('%(message)s')
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(formatter)

    # Couper TOUT par défaut - désactiver le root logger avec force=True
    logging.basicConfig(level=logging.CRITICAL, handlers=[], force=True)
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.CRITICAL)
    root_logger.handlers = []

    # Désactiver TOUS les loggers bruyants (liste exhaustive)
    silent_loggers = [
        '', 'root', 'app', 'chatkit', 'chatkit.telephony', 'chatkit.telephony.pjsua',
        'chatkit.server', 'chatkit.telephony.voice_bridge', 'chatkit.realtime',
        'httpcore', 'httpcore.http11', 'httpcore.connection', 'httpx',
        'mcp', 'mcp.client', 'mcp.client.sse', 'mcp.client.stdio',
        'openai', 'openai.agents', 'openai._base_client',
        'uvicorn', 'uvicorn.access', 'uvicorn.error',
        'fastapi', 'sqlalchemy', 'websockets', 'agents', 'agents.realtime'
    ]

    for name in silent_loggers:
        logger = logging.getLogger(name)
        logger.setLevel(logging.CRITICAL)
        logger.handlers = []
        logger.propagate = False
        logger.disabled = True  # FORCER la désactivation

    # Activer UNIQUEMENT le call tracker
    call_tracker = logging.getLogger('chatkit.telephony.call_tracker')
    call_tracker.setLevel(logging.INFO)
    call_tracker.handlers = [handler]
    call_tracker.propagate = False
    call_tracker.disabled = False

    # Désactiver aussi les logs natifs de PJSIP
    os.environ['PJSIP_LOG_LEVEL'] = '0'

    print("✅ Logs filtrés: UNIQUEMENT chatkit.telephony.call_tracker visible")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import (
    admin,
    auth,
    docs,
    mcp,
    model_registry,
    outbound,
    tools,
    users,
    vector_stores,
    voice_settings,
    widgets,
    workflows,
)

try:  # pragma: no cover - dépendance optionnelle pour le SDK ChatKit
    from .routes import chatkit as chatkit_routes
except (
    ModuleNotFoundError
):  # pragma: no cover - utilisé dans l'environnement de tests sans SDK
    chatkit_routes = None  # type: ignore[assignment]
from .startup import register_startup_events

settings = get_settings()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=True,
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(docs.router)
app.include_router(model_registry.router)
app.include_router(mcp.router)
if chatkit_routes and hasattr(chatkit_routes, "router"):
    app.include_router(chatkit_routes.router)
app.include_router(tools.router)
app.include_router(vector_stores.router)
app.include_router(voice_settings.router)
app.include_router(widgets.router)
app.include_router(workflows.router)
app.include_router(outbound.router)

register_startup_events(app)
