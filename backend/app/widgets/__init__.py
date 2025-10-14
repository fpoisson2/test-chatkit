"""Gestion centralisée des widgets ChatKit stockés côté serveur."""

from .service import WidgetLibraryService, WidgetValidationError

__all__ = ["WidgetLibraryService", "WidgetValidationError"]
