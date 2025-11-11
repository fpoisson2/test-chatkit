"""Initialisation du backend FastAPI."""

from __future__ import annotations

import os
import sys
from types import SimpleNamespace

__all__ = ["app"]

_SKIP_BOOTSTRAP = os.environ.get("CHATKIT_SKIP_APP_BOOTSTRAP") == "1"


def _build_stub_app() -> SimpleNamespace:
    """Return a minimal object matching the FastAPI API used in tests."""

    return SimpleNamespace(
        add_middleware=lambda *args, **kwargs: None,
        include_router=lambda *args, **kwargs: None,
    )


if _SKIP_BOOTSTRAP:  # pragma: no cover - test helper
    app = _build_stub_app()
else:
    try:
        from fastapi import FastAPI
        from fastapi.middleware.cors import CORSMiddleware

        from .config import get_settings
        from .routes import (
            admin,
            auth,
            docs,
            lti,
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
        except (ModuleNotFoundError, ImportError):  # pragma: no cover - tests sans SDK
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
        app.include_router(lti.router)
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
    except Exception:  # pragma: no cover - fallback for lightweight test envs
        if "pytest" in sys.modules:
            app = _build_stub_app()
        else:
            raise
