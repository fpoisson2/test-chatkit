from __future__ import annotations

import json
import logging
from typing import Any, Iterable

from pydantic import ValidationError

try:  # pragma: no cover - import conditionnel selon la version de Pydantic
    from pydantic import TypeAdapter
except ImportError:  # pragma: no cover - Pydantic v1
    TypeAdapter = None  # type: ignore[assignment]

try:  # pragma: no cover - API disponible sur Pydantic v1
    from pydantic import parse_obj_as
except ImportError:  # pragma: no cover - supprimé en v2
    parse_obj_as = None  # type: ignore[assignment]
from sqlalchemy import select
from sqlalchemy.orm import Session

try:  # pragma: no cover - dépendance optionnelle pour les tests rapides
    from chatkit.widgets import WidgetRoot
except ModuleNotFoundError:  # pragma: no cover - lorsque le SDK n'est pas disponible
    WidgetRoot = None  # type: ignore[assignment]

from ..models import WidgetTemplate

logger = logging.getLogger("chatkit.widgets")


class WidgetValidationError(ValueError):
    """Erreur levée lorsque la définition d'un widget n'est pas valide."""

    def __init__(self, message: str, *, errors: Iterable[str] | None = None) -> None:
        super().__init__(message)
        self.errors = list(errors or [])


class WidgetLibraryService:
    """Encapsule la gestion des widgets stockés dans la base."""

    def __init__(self, session: Session) -> None:
        self.session = session

    # -- Opérations CRUD -----------------------------------------------------

    def list_widgets(self) -> list[WidgetTemplate]:
        stmt = select(WidgetTemplate).order_by(WidgetTemplate.slug.asc())
        return list(self.session.scalars(stmt))

    def get_widget(self, slug: str) -> WidgetTemplate | None:
        normalized = slug.strip()
        if not normalized:
            return None
        stmt = select(WidgetTemplate).where(WidgetTemplate.slug == normalized)
        return self.session.scalar(stmt)

    def create_widget(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        definition: dict[str, Any] | str,
    ) -> WidgetTemplate:
        normalized_slug = slug.strip()
        if not normalized_slug:
            raise ValueError("Le slug du widget ne peut pas être vide")

        existing = self.get_widget(normalized_slug)
        if existing is not None:
            raise ValueError("Un widget avec ce slug existe déjà")

        normalized_definition = self._normalize_definition(definition)

        widget = WidgetTemplate(
            slug=normalized_slug,
            title=self._normalize_text(title),
            description=self._normalize_text(description),
            definition=normalized_definition,
        )
        self.session.add(widget)
        self.session.flush()
        return widget

    def update_widget(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        definition: dict[str, Any] | str | None = None,
    ) -> WidgetTemplate:
        widget = self.get_widget(slug)
        if widget is None:
            raise LookupError("Widget introuvable")

        if title is not None:
            widget.title = self._normalize_text(title)
        if description is not None:
            widget.description = self._normalize_text(description)
        if definition is not None:
            widget.definition = self._normalize_definition(definition)

        self.session.add(widget)
        self.session.flush()
        return widget

    def delete_widget(self, slug: str) -> None:
        widget = self.get_widget(slug)
        if widget is None:
            raise LookupError("Widget introuvable")
        self.session.delete(widget)
        self.session.flush()

    # -- Validation ----------------------------------------------------------

    def preview_widget(self, definition: dict[str, Any] | str) -> dict[str, Any]:
        return self._normalize_definition(definition)

    @staticmethod
    def _normalize_definition(definition: dict[str, Any] | str) -> dict[str, Any]:
        widget = WidgetLibraryService._validate_widget(definition)
        dumped = WidgetLibraryService._dump_widget(widget)
        return json.loads(json.dumps(dumped, ensure_ascii=False))

    @staticmethod
    def _dump_widget(widget: Any) -> dict[str, Any]:
        """Serialize un widget validé quel que soit le runtime Pydantic."""

        if hasattr(widget, "model_dump"):
            dump_method = getattr(widget, "model_dump")
            try:
                dumped = dump_method(mode="json")
            except TypeError:
                dumped = dump_method()
        elif hasattr(widget, "dict"):
            dump_method = getattr(widget, "dict")
            dumped = dump_method()
        elif isinstance(widget, dict):
            dumped = widget
        else:  # pragma: no cover - protection supplémentaire
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["Le widget ne peut pas être sérialisé."],
            )

        if not isinstance(dumped, dict):
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["La définition normalisée doit être un objet JSON."],
            )

        return dumped

    @staticmethod
    def _validate_widget(definition: dict[str, Any] | str) -> Any:
        if WidgetRoot is None:
            raise RuntimeError(
                "Le module chatkit.widgets est requis pour valider les widgets. "
                "Installez le SDK ChatKit pour utiliser la bibliothèque de widgets."
            )
        try:
            adapter = None
            if TypeAdapter is not None:
                try:
                    adapter = TypeAdapter(WidgetRoot)
                except TypeError:  # pragma: no cover - typage inattendu
                    logger.debug(
                        "Impossible de construire un TypeAdapter pour %s", WidgetRoot
                    )
            if isinstance(definition, str):
                if adapter is not None:
                    widget = adapter.validate_json(definition)
                else:
                    if parse_obj_as is None:
                        raise RuntimeError(
                            "Aucun validateur Pydantic disponible pour les widgets"
                        )
                    widget = parse_obj_as(WidgetRoot, json.loads(definition))
            else:
                if adapter is not None:
                    widget = adapter.validate_python(definition)
                else:
                    if parse_obj_as is None:
                        raise RuntimeError(
                            "Aucun validateur Pydantic disponible pour les widgets"
                        )
                    widget = parse_obj_as(WidgetRoot, definition)
        except ValidationError as exc:  # pragma: no cover - dépendant de la structure exacte
            logger.debug("Widget invalide: %s", exc, exc_info=exc)
            messages = []
            for error in exc.errors():
                location = ".".join(str(part) for part in error.get("loc", ()))
                messages.append(f"{location}: {error.get('msg')}")
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=messages,
            ) from exc
        return widget

    @staticmethod
    def _normalize_text(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
