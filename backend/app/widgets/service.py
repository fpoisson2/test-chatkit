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
from ..vector_store import JsonVectorStoreService

logger = logging.getLogger("chatkit.widgets")

WIDGET_VECTOR_STORE_SLUG = "chatkit-widgets"
"""Identifiant du vector store dédié à l'indexation des widgets."""

WIDGET_VECTOR_STORE_TITLE = "Bibliothèque de widgets"
"""Titre appliqué lors de la création automatique du vector store."""

WIDGET_VECTOR_STORE_METADATA = {"scope": "widget_library"}
"""Métadonnées associées au vector store des widgets."""


class WidgetValidationError(ValueError):
    """Erreur levée lorsque la définition d'un widget n'est pas valide."""

    def __init__(self, message: str, *, errors: Iterable[str] | None = None) -> None:
        super().__init__(message)
        self.errors = list(errors or [])


class WidgetLibraryService:
    """Encapsule la gestion des widgets stockés dans la base."""

    def __init__(
        self,
        session: Session,
        *,
        vector_store_slug: str | None = WIDGET_VECTOR_STORE_SLUG,
    ) -> None:
        self.session = session
        self._vector_store_slug = (vector_store_slug or "").strip()
        self._vector_store_disabled = False

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
        self._sync_vector_store(widget)
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
        self._sync_vector_store(widget)
        return widget

    def delete_widget(self, slug: str) -> None:
        widget = self.get_widget(slug)
        if widget is None:
            raise LookupError("Widget introuvable")
        self._remove_from_vector_store(widget.slug)
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

    # -- Intégration vector store -------------------------------------------

    def _vector_store_enabled(self) -> bool:
        return bool(self._vector_store_slug) and not self._vector_store_disabled

    def _sync_vector_store(self, widget: WidgetTemplate) -> None:
        if not self._vector_store_enabled():
            return
        payload = {
            "slug": widget.slug,
            "title": widget.title,
            "description": widget.description,
            "definition": widget.definition,
        }
        metadata = {
            "slug": widget.slug,
            "title": widget.title,
            "description": widget.description,
        }
        try:
            service = JsonVectorStoreService(self.session)
            service.ingest(
                self._vector_store_slug,
                widget.slug,
                payload,
                store_title=WIDGET_VECTOR_STORE_TITLE,
                store_metadata=WIDGET_VECTOR_STORE_METADATA,
                document_metadata={
                    key: value for key, value in metadata.items() if value is not None
                },
            )
        except RuntimeError as exc:
            logger.debug(
                "Vector store indisponible pour la bibliothèque de widgets (%s)",
                exc,
            )
            self._vector_store_disabled = True
        except Exception as exc:  # pragma: no cover - dépend du runtime
            logger.warning(
                "Impossible d'indexer le widget %s dans le vector store", widget.slug,
                exc_info=exc,
            )

    def _remove_from_vector_store(self, slug: str) -> None:
        if not self._vector_store_enabled():
            return
        try:
            service = JsonVectorStoreService(self.session)
            service.delete_document(self._vector_store_slug, slug)
        except LookupError:
            logger.debug(
                "Document vector store introuvable pour le widget %s", slug
            )
        except Exception as exc:  # pragma: no cover - dépend du runtime
            logger.warning(
                "Impossible de supprimer le widget %s du vector store", slug,
                exc_info=exc,
            )

    @staticmethod
    def _normalize_text(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None
