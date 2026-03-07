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
        from fastapi import FastAPI, Request
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import JSONResponse
        from starlette.middleware.base import BaseHTTPMiddleware

        from .config import get_settings

        # Paths that are allowed to be embedded in iframes (LTI integration)
        LTI_IFRAME_PATHS = (
            "/api/lti/",
            "/.well-known/jwks.json",
        )

        class SecurityHeadersMiddleware(BaseHTTPMiddleware):
            """Middleware to add security headers to all responses."""

            async def dispatch(self, request: Request, call_next):
                response = await call_next(request)
                path = request.url.path

                # Allow LTI routes to be embedded in iframes
                is_lti_path = any(path.startswith(p) for p in LTI_IFRAME_PATHS)

                # Prevent clickjacking (except for LTI routes which need iframe embedding)
                if not is_lti_path:
                    response.headers["X-Frame-Options"] = "DENY"
                # Prevent MIME type sniffing
                response.headers["X-Content-Type-Options"] = "nosniff"
                # XSS protection (legacy browsers)
                response.headers["X-XSS-Protection"] = "1; mode=block"
                # Referrer policy
                response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
                # Permissions policy (restrict browser features)
                response.headers["Permissions-Policy"] = (
                    "geolocation=(), microphone=(), camera=()"
                )
                return response

        # Try to import slowapi for rate limiting (optional)
        try:
            from slowapi.errors import RateLimitExceeded
            from slowapi.middleware import SlowAPIMiddleware
            from .rate_limit import limiter
            _RATE_LIMITING_AVAILABLE = True
        except ImportError:
            _RATE_LIMITING_AVAILABLE = False
            limiter = None
            SlowAPIMiddleware = None
        from .routes import (
            admin,
            auth,
            computer as computer_routes,
            docs,
            github,
            github_ws,
            health,
            languages,
            lti,
            mcp,
            model_registry,
            outbound,
            tools,
            users,
            vector_stores,
            voice_settings,
            widgets,
            workflow_monitor_ws,
            workflows,
        )

        try:  # pragma: no cover - dépendance optionnelle pour le SDK ChatKit
            from .routes import chatkit as chatkit_routes
        except (ModuleNotFoundError, ImportError):  # pragma: no cover - tests sans SDK
            chatkit_routes = None  # type: ignore[assignment]
        from .startup import register_startup_events

        settings = get_settings()

        app = FastAPI()

        # Add rate limiter state to app (if available)
        if _RATE_LIMITING_AVAILABLE:
            import logging
            logger = logging.getLogger(__name__)
            logger.info("Rate limiting is ENABLED (slowapi installed)")

            app.state.limiter = limiter

            # Custom rate limit error handler that returns FastAPI-compatible format
            async def rate_limit_exceeded_handler(request: Request, exc: RateLimitExceeded) -> JSONResponse:
                """Handle rate limit exceeded errors with consistent format."""
                logger.warning(
                    f"Rate limit exceeded for {request.method} {request.url.path} "
                    f"from {request.client.host if request.client else 'unknown'}"
                )
                return JSONResponse(
                    status_code=429,
                    content={"detail": "Trop de requêtes. Veuillez réessayer plus tard."},
                    headers={"Retry-After": str(exc.detail) if hasattr(exc, 'detail') else "60"},
                )

            app.add_exception_handler(RateLimitExceeded, rate_limit_exceeded_handler)
        else:
            import logging
            logger = logging.getLogger(__name__)
            logger.warning(
                "Rate limiting is DISABLED: slowapi package not installed. "
                "Install with: pip install slowapi>=0.1.9"
            )

        # Add security headers middleware first (outermost)
        app.add_middleware(SecurityHeadersMiddleware)

        # Add CORS middleware only if allowed_origins is configured
        if settings.allowed_origins:
            app.add_middleware(
                CORSMiddleware,
                allow_origins=settings.allowed_origins,
                allow_methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
                allow_headers=["Authorization", "Content-Type", "X-Requested-With"],
                allow_credentials=True,
            )

        # Add SlowAPI middleware for rate limiting (if available)
        if _RATE_LIMITING_AVAILABLE and SlowAPIMiddleware:
            app.add_middleware(SlowAPIMiddleware)

        app.include_router(auth.router)
        app.include_router(users.router)
        app.include_router(admin.router)
        app.include_router(workflow_monitor_ws.router)
        from .routes import voice_relay_ws
        app.include_router(voice_relay_ws.router)
        app.include_router(computer_routes.router)
        app.include_router(docs.router)
        app.include_router(github.router)
        app.include_router(github_ws.router)
        app.include_router(health.router)
        app.include_router(languages.router)
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

        # Privacy policy page (required for Google Play)
        from fastapi.responses import HTMLResponse

        @app.get("/privacy", response_class=HTMLResponse, include_in_schema=False)
        async def privacy_policy():
            return """<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>EDxo - Politique de confidentialite</title>
<style>
body{font-family:-apple-system,sans-serif;max-width:700px;margin:40px auto;padding:0 20px;color:#333;line-height:1.6}
h1{color:#1a1a2e}h2{color:#444;margin-top:2em}
</style>
</head>
<body>
<h1>Politique de confidentialite - EDxo</h1>
<p>Derniere mise a jour : 7 mars 2026</p>
<h2>1. Donnees collectees</h2>
<p>EDxo collecte les donnees suivantes pour le fonctionnement de l'application :</p>
<ul>
<li><strong>Compte utilisateur</strong> : adresse email et mot de passe (chiffre)</li>
<li><strong>Donnees audio</strong> : enregistrements vocaux transmis en temps reel pour le traitement par l'assistant vocal. Les enregistrements ne sont pas conserves apres la fin de la session.</li>
<li><strong>Donnees d'utilisation</strong> : workflows selectionnes, parametres de l'application</li>
</ul>
<h2>2. Utilisation des donnees</h2>
<p>Les donnees sont utilisees exclusivement pour :</p>
<ul>
<li>Authentifier l'utilisateur</li>
<li>Fournir les fonctionnalites de l'assistant vocal</li>
<li>Synchroniser les parametres entre le telephone et la montre</li>
</ul>
<h2>3. Partage des donnees</h2>
<p>Les donnees audio sont transmises aux services d'intelligence artificielle (OpenAI) pour le traitement vocal. Aucune autre donnee n'est partagee avec des tiers.</p>
<h2>4. Stockage et securite</h2>
<p>Les donnees sont stockees sur des serveurs securises. Les mots de passe sont chiffres. Les communications sont protegees par TLS/SSL.</p>
<h2>5. Permissions de l'application</h2>
<ul>
<li><strong>Microphone</strong> : requis pour l'assistant vocal</li>
<li><strong>Internet</strong> : requis pour la communication avec le serveur</li>
</ul>
<h2>6. Suppression des donnees</h2>
<p>Vous pouvez supprimer votre compte et toutes les donnees associees en contactant l'administrateur du serveur.</p>
<h2>7. Contact</h2>
<p>Pour toute question concernant cette politique, contactez l'administrateur de votre instance EDxo.</p>
</body>
</html>"""

        register_startup_events(app)
    except Exception:  # pragma: no cover - fallback for lightweight test envs
        if "pytest" in sys.modules:
            app = _build_stub_app()
        else:
            raise
