"""Regroupe les routeurs FastAPI du backend."""

from . import admin, auth, chatkit, tools, users, workflows  # noqa: F401

__all__ = ["admin", "auth", "chatkit", "tools", "users", "workflows"]
