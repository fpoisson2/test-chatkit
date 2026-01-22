"""Initialisation du backend FastAPI."""

from __future__ import annotations

import os
import sys
import uuid
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
        import time

        from fastapi import FastAPI, Request
        from fastapi.middleware.cors import CORSMiddleware
        from fastapi.responses import JSONResponse
        from starlette.middleware.base import BaseHTTPMiddleware
        import structlog

        from .config import get_settings
        from .database import (
            clear_request_stats,
            get_request_stats,
            reset_request_stats,
            set_request_id,
        )

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

        request_logger = structlog.get_logger("chatkit.request")
        disable_tracing = os.getenv("CHATKIT_DISABLE_TRACING", "").lower() in (
            "1",
            "true",
            "yes",
        )
        if disable_tracing:
            try:
                from agents.tracing import set_tracing_disabled

                set_tracing_disabled(True)
                request_logger.info("tracing.disabled")
            except Exception:
                request_logger.warning("tracing.disable.failed", exc_info=True)
        slow_request_threshold_ms = float(os.getenv("REQUEST_LOG_SLOW_MS", "200"))
        log_every_request = os.getenv("REQUEST_LOG_EACH", "").lower() in (
            "1",
            "true",
            "yes",
        )
        query_count_threshold = float(
            os.getenv("REQUEST_LOG_QUERY_COUNT", "50")
        )

        @app.middleware("http")
        async def log_slow_requests(request: Request, call_next):
            start = time.perf_counter()
            request_id = str(uuid.uuid4())
            request.state.request_id = request_id
            set_request_id(request_id)
            reset_request_stats(request_id)
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start) * 1000.0
            db_stats = get_request_stats(request_id)
            query_count = int(db_stats.get("count", 0.0))
            db_total_ms = round(db_stats.get("total_ms", 0.0), 2)
            db_max_ms = round(db_stats.get("max_ms", 0.0), 2)
            should_log = (
                log_every_request
                or duration_ms >= slow_request_threshold_ms
                or query_count >= query_count_threshold
            )
            if should_log:
                request_logger.info(
                    "slow_request",
                    method=request.method,
                    path=request.url.path,
                    status_code=response.status_code,
                    duration_ms=round(duration_ms, 2),
                    client=request.client.host if request.client else None,
                    db_query_count=query_count,
                    db_total_ms=db_total_ms,
                    db_max_ms=db_max_ms,
                )
            clear_request_stats(request_id)
            set_request_id(None)
            return response

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

        register_startup_events(app)
    except Exception:  # pragma: no cover - fallback for lightweight test envs
        if "pytest" in sys.modules:
            app = _build_stub_app()
        else:
            raise
