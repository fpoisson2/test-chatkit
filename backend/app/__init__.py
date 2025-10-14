"""Initialisation du backend FastAPI."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes import admin, auth, model_registry, tools, users, vector_stores, workflows

try:  # pragma: no cover - dépendance optionnelle pour le SDK ChatKit
    from .routes import chatkit
except ModuleNotFoundError:  # pragma: no cover - utilisé dans l'environnement de tests sans SDK
    chatkit = None  # type: ignore[assignment]
from .startup import register_startup_events

settings = get_settings()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(users.router)
app.include_router(admin.router)
app.include_router(model_registry.router)
if chatkit and hasattr(chatkit, "router"):
    app.include_router(chatkit.router)
app.include_router(tools.router)
app.include_router(vector_stores.router)
app.include_router(workflows.router)

register_startup_events(app)
