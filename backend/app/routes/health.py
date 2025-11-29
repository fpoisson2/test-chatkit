"""Health check endpoints for monitoring application status."""

import logging
import os
from typing import Dict, Any

from fastapi import APIRouter, Depends
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import text
from sqlalchemy.orm import Session
from redis.asyncio import Redis, from_url

from app.database import get_session

router = APIRouter(prefix="/health", tags=["health"])
logger = logging.getLogger(__name__)

# Get Redis URL from environment (same as Celery/RateLimit)
REDIS_URL = os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0")

@router.get("/", summary="Health check")
async def health_check(
    db: Session = Depends(get_session),
) -> Dict[str, Any]:
    """
    Check the health of the application and its dependencies.
    """
    status: Dict[str, Any] = {
        "status": "ok",
        "components": {
            "database": "unknown",
            "redis": "unknown",
        }
    }

    # Check Database
    try:
        # Run blocking DB call in threadpool since this is an async route
        await run_in_threadpool(db.execute, text("SELECT 1"))
        status["components"]["database"] = "ok"
    except Exception as e:
        logger.error(f"Health check failed for database: {e}")
        status["components"]["database"] = "error"
        status["status"] = "degraded"

    # Check Redis
    try:
        # Creating a client for each check is not ideal for high-throughput, but acceptable for a health check
        # endpoint that is typically polled at a reasonable interval (e.g. 10s-30s).
        # Reusing a global client would be better but requires more complex lifecycle management here.
        async with from_url(REDIS_URL, encoding="utf-8", decode_responses=True) as redis:
            await redis.ping()
        status["components"]["redis"] = "ok"
    except Exception as e:
        logger.error(f"Health check failed for redis: {e}")
        status["components"]["redis"] = "error"
        status["status"] = "degraded"

    return status
