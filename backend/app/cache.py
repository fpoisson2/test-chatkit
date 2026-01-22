"""Redis cache for reducing database latency.

This module provides a simple caching layer using Redis to cache
frequently accessed data like workflows, reducing round-trips to Supabase.
"""

from __future__ import annotations

import json
import logging
import os
from functools import wraps
from typing import Any, Callable, TypeVar

import redis

logger = logging.getLogger(__name__)

T = TypeVar("T")

# Global Redis client
_redis_client: redis.Redis | None = None


def get_redis_client() -> redis.Redis | None:
    """Get or create the Redis client."""
    global _redis_client
    if _redis_client is None:
        redis_url = os.getenv("CELERY_BROKER_URL", "redis://redis:6380/0")
        try:
            _redis_client = redis.from_url(redis_url, decode_responses=True)
            _redis_client.ping()
            logger.info("Redis cache connected", extra={"redis_url": redis_url})
        except Exception as e:
            logger.warning(f"Redis cache not available: {e}")
            _redis_client = None
    return _redis_client


def cache_key(prefix: str, *args: Any) -> str:
    """Generate a cache key from prefix and arguments."""
    parts = [prefix] + [str(a) for a in args if a is not None]
    return ":".join(parts)


def get_cached(key: str) -> Any | None:
    """Get a value from cache."""
    client = get_redis_client()
    if client is None:
        return None
    try:
        data = client.get(key)
        if data:
            return json.loads(data)
    except Exception as e:
        logger.debug(f"Cache get error: {e}")
    return None


def set_cached(key: str, value: Any, ttl: int = 300) -> bool:
    """Set a value in cache with TTL (default 5 minutes)."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        client.setex(key, ttl, json.dumps(value, default=str))
        return True
    except Exception as e:
        logger.debug(f"Cache set error: {e}")
        return False


def delete_cached(key: str) -> bool:
    """Delete a value from cache."""
    client = get_redis_client()
    if client is None:
        return False
    try:
        client.delete(key)
        return True
    except Exception as e:
        logger.debug(f"Cache delete error: {e}")
        return False


def invalidate_pattern(pattern: str) -> int:
    """Delete all keys matching a pattern."""
    client = get_redis_client()
    if client is None:
        return 0
    try:
        keys = client.keys(pattern)
        if keys:
            return client.delete(*keys)
    except Exception as e:
        logger.debug(f"Cache invalidate error: {e}")
    return 0


# Specific cache functions for workflows

WORKFLOW_CACHE_TTL = 300  # 5 minutes
WORKFLOW_LIST_KEY = "workflows:list"
WORKFLOW_KEY_PREFIX = "workflow"
WORKFLOW_DEF_KEY_PREFIX = "workflow_def"


def get_cached_workflow_list() -> list[dict] | None:
    """Get cached list of workflows."""
    return get_cached(WORKFLOW_LIST_KEY)


def set_cached_workflow_list(workflows: list[dict], ttl: int = WORKFLOW_CACHE_TTL) -> bool:
    """Cache the list of workflows."""
    return set_cached(WORKFLOW_LIST_KEY, workflows, ttl)


def get_cached_workflow(workflow_id: int | str) -> dict | None:
    """Get a cached workflow by ID."""
    return get_cached(cache_key(WORKFLOW_KEY_PREFIX, workflow_id))


def set_cached_workflow(workflow_id: int | str, workflow: dict, ttl: int = WORKFLOW_CACHE_TTL) -> bool:
    """Cache a workflow."""
    return set_cached(cache_key(WORKFLOW_KEY_PREFIX, workflow_id), workflow, ttl)


def get_cached_workflow_definition(definition_id: int | str) -> dict | None:
    """Get a cached workflow definition by ID."""
    return get_cached(cache_key(WORKFLOW_DEF_KEY_PREFIX, definition_id))


def set_cached_workflow_definition(
    definition_id: int | str, definition: dict, ttl: int = WORKFLOW_CACHE_TTL
) -> bool:
    """Cache a workflow definition."""
    return set_cached(cache_key(WORKFLOW_DEF_KEY_PREFIX, definition_id), definition, ttl)


def invalidate_workflow_cache(workflow_id: int | str | None = None) -> None:
    """Invalidate workflow cache.

    If workflow_id is provided, only invalidate that workflow.
    Otherwise, invalidate all workflow caches.
    """
    if workflow_id:
        delete_cached(cache_key(WORKFLOW_KEY_PREFIX, workflow_id))
        delete_cached(WORKFLOW_LIST_KEY)
    else:
        invalidate_pattern("workflow*")
        delete_cached(WORKFLOW_LIST_KEY)


def invalidate_workflow_definition_cache(definition_id: int | str | None = None) -> None:
    """Invalidate workflow definition cache."""
    if definition_id:
        delete_cached(cache_key(WORKFLOW_DEF_KEY_PREFIX, definition_id))
    else:
        invalidate_pattern(f"{WORKFLOW_DEF_KEY_PREFIX}:*")
