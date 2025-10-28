"""Initialisation du backend FastAPI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import (
    admin,
    auth,
    docs,
    model_registry,
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
if chatkit_routes and hasattr(chatkit_routes, "router"):
    app.include_router(chatkit_routes.router)
app.include_router(tools.router)
app.include_router(vector_stores.router)
app.include_router(voice_settings.router)
app.include_router(widgets.router)
app.include_router(workflows.router)

register_startup_events(app)
