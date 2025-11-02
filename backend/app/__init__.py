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

    # Couper TOUT par défaut
    logging.basicConfig(level=logging.CRITICAL, handlers=[])

    # Désactiver tous les loggers bruyants
    for name in ['chatkit.telephony.pjsua', 'chatkit.server', 'chatkit.telephony.voice_bridge',
                 'chatkit.realtime', 'httpcore', 'httpx', 'mcp', 'openai', 'uvicorn',
                 'uvicorn.access', 'uvicorn.error']:
        logging.getLogger(name).setLevel(logging.CRITICAL)
        logging.getLogger(name).propagate = False

    # Activer UNIQUEMENT le call tracker
    call_tracker = logging.getLogger('chatkit.telephony.call_tracker')
    call_tracker.setLevel(logging.INFO)
    call_tracker.handlers = [handler]
    call_tracker.propagate = False

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
