"""Rate limiting configuration for FastAPI using slowapi."""

from __future__ import annotations

import os

try:
    from slowapi import Limiter
    from slowapi.util import get_remote_address
    _SLOWAPI_AVAILABLE = True
except ImportError:
    _SLOWAPI_AVAILABLE = False
    Limiter = None  # type: ignore
    get_remote_address = None  # type: ignore


def _get_rate_limit_key(request):
    """
    Get the key for rate limiting.

    Uses the authenticated user ID if available, otherwise falls back to IP address.
    This provides more accurate rate limiting for authenticated requests.
    """
    # Try to get user from request state (set by auth middleware)
    if hasattr(request.state, "user") and request.state.user:
        return f"user:{request.state.user.id}"

    # Fall back to IP address for unauthenticated requests
    return f"ip:{get_remote_address(request)}"


# Get Redis URL from environment (same as Celery)
REDIS_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")


# Rate limit configurations for different endpoint types
RATE_LIMITS = {
    # Authentication endpoints - strict limits to prevent brute force
    "auth_login": "5/minute",  # 5 login attempts per minute
    "auth_register": "3/hour",  # 3 registrations per hour

    # API endpoints - moderate limits for normal usage
    "api_default": "60/minute",  # 60 requests per minute for general API calls
    "api_read": "100/minute",  # Higher limit for read operations
    "api_write": "30/minute",  # Lower limit for write operations

    # Admin endpoints - moderate limits
    "admin": "30/minute",

    # Workflow operations - moderate limits
    "workflow_execute": "20/minute",

    # File uploads - strict limits
    "file_upload": "10/minute",

    # AI/LLM endpoints - moderate limits for authenticated users
    "ai_chat": "100/minute",  # Increased for better user experience
    "ai_voice": "10/minute",
}


def get_rate_limit(limit_type: str) -> str:
    """Get the rate limit string for a given limit type."""
    return RATE_LIMITS.get(limit_type, RATE_LIMITS["api_default"])


# Initialize the limiter based on slowapi availability
if _SLOWAPI_AVAILABLE:
    # Initialize the limiter with Redis backend
    # This allows rate limiting to work across multiple workers/processes
    limiter = Limiter(
        key_func=_get_rate_limit_key,
        default_limits=[],  # No default limits, we'll apply per-route
        storage_uri=REDIS_URL,
        enabled=os.environ.get("RATE_LIMIT_ENABLED", "true").lower() == "true",
    )
else:
    # Create a dummy limiter when slowapi is not installed
    class _DummyLimiter:
        """Fallback limiter when slowapi is not installed."""
        def limit(self, *args, **kwargs):
            """No-op decorator that does nothing."""
            def decorator(func):
                return func
            return decorator

    limiter = _DummyLimiter()  # type: ignore
