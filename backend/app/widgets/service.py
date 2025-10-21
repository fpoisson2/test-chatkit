from __future__ import annotations

import datetime
import json
import logging
from dataclasses import asdict, dataclass
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
from sqlalchemy.orm import Session

try:  # pragma: no cover - dépendance optionnelle pour les tests rapides
    from chatkit.widgets import WidgetRoot
except ModuleNotFoundError:  # pragma: no cover - lorsque le SDK n'est pas disponible
    WidgetRoot = None  # type: ignore[assignment]

from ..models import JsonDocument
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


@dataclass(slots=True)
class WidgetTemplateEntry:
    """Représentation immuable d'un widget stocké dans le vector store."""

    slug: str
    title: str | None
    description: str | None
    definition: dict[str, Any]
    created_at: datetime.datetime
    updated_at: datetime.datetime

    def as_response(self) -> dict[str, Any]:
        return asdict(self)

    def as_summary(self) -> dict[str, Any]:
        return {
            "slug": self.slug,
            "title": self.title,
            "description": self.description,
        }


class WidgetLibraryService:
    """Encapsule la gestion des widgets stockés dans le vector store."""

    def __init__(
        self,
        session: Session,
        *,
        vector_store_slug: str | None = WIDGET_VECTOR_STORE_SLUG,
    ) -> None:
        self.session = session
        self._vector_store_slug = (vector_store_slug or "").strip()
        if not self._vector_store_slug:
            raise RuntimeError(
                "Le vector store des widgets doit être configuré pour utiliser la bibliothèque."
            )

    def _vector_service(self) -> JsonVectorStoreService:
        return JsonVectorStoreService(self.session)

    # -- Opérations CRUD -----------------------------------------------------

    def list_widgets(self) -> list[WidgetTemplateEntry]:
        service = self._vector_service()
        try:
            documents = service.list_documents(self._vector_store_slug)
        except LookupError:
            return []

        widgets: list[WidgetTemplateEntry] = []
        for document, _chunk_count in documents:
            try:
                widgets.append(self._from_document(document))
            except WidgetValidationError as exc:
                logger.warning(
                    "Widget invalide ignoré dans le vector store (%s): %s",
                    document.doc_id,
                    exc,
                )
        return widgets

    def get_widget(self, slug: str) -> WidgetTemplateEntry | None:
        normalized = slug.strip()
        if not normalized:
            return None
        document = self._vector_service().get_document(self._vector_store_slug, normalized)
        if document is None:
            return None
        return self._from_document(document)

    def create_widget(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        definition: dict[str, Any] | str,
    ) -> WidgetTemplateEntry:
        normalized_slug = slug.strip()
        if not normalized_slug:
            raise ValueError("Le slug du widget ne peut pas être vide")

        existing = self.get_widget(normalized_slug)
        if existing is not None:
            raise ValueError("Un widget avec ce slug existe déjà")

        normalized_definition = self._normalize_definition(definition)

        payload = {
            "slug": normalized_slug,
            "title": self._normalize_text(title),
            "description": self._normalize_text(description),
            "definition": normalized_definition,
        }

        service = self._vector_service()
        document = service.ingest(
            self._vector_store_slug,
            normalized_slug,
            payload,
            store_title=WIDGET_VECTOR_STORE_TITLE,
            store_metadata=WIDGET_VECTOR_STORE_METADATA,
            document_metadata={
                key: value
                for key, value in payload.items()
                if key != "definition" and value is not None
            },
        )
        return self._from_document(document)

    def update_widget(
        self,
        slug: str,
        *,
        title: str | None = None,
        description: str | None = None,
        definition: dict[str, Any] | str | None = None,
    ) -> WidgetTemplateEntry:
        existing = self.get_widget(slug)
        if existing is None:
            raise LookupError("Widget introuvable")

        updated_payload = {
            "slug": existing.slug,
            "title": existing.title if title is None else self._normalize_text(title),
            "description": existing.description
            if description is None
            else self._normalize_text(description),
            "definition": existing.definition
            if definition is None
            else self._normalize_definition(definition),
        }

        document = self._vector_service().ingest(
            self._vector_store_slug,
            existing.slug,
            updated_payload,
            store_title=WIDGET_VECTOR_STORE_TITLE,
            store_metadata=WIDGET_VECTOR_STORE_METADATA,
            document_metadata={
                key: value
                for key, value in updated_payload.items()
                if key != "definition" and value is not None
            },
        )
        return self._from_document(document)

    def delete_widget(self, slug: str) -> None:
        existing = self.get_widget(slug)
        if existing is None:
            raise LookupError("Widget introuvable")
        self._vector_service().delete_document(self._vector_store_slug, existing.slug)

    # -- Validation ----------------------------------------------------------

    def preview_widget(self, definition: dict[str, Any] | str) -> dict[str, Any]:
        return self._normalize_definition(definition)

    @staticmethod
    def _normalize_definition(definition: dict[str, Any] | str) -> dict[str, Any]:
        payload = WidgetLibraryService._coerce_definition_payload(definition)
        widget = WidgetLibraryService._validate_widget(payload)
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
            payload = WidgetLibraryService._coerce_definition_payload(definition)

            adapter = None
            if TypeAdapter is not None:
                try:
                    adapter = TypeAdapter(WidgetRoot)
                except TypeError:  # pragma: no cover - typage inattendu
                    logger.debug(
                        "Impossible de construire un TypeAdapter pour %s", WidgetRoot
                    )
            if adapter is not None:
                widget = adapter.validate_python(payload)
            else:
                if parse_obj_as is None:
                    raise RuntimeError(
                        "Aucun validateur Pydantic disponible pour les widgets"
                    )
                widget = parse_obj_as(WidgetRoot, payload)
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
    def _coerce_definition_payload(
        definition: dict[str, Any] | str,
    ) -> dict[str, Any]:
        if isinstance(definition, dict):
            return definition
        if isinstance(definition, str):
            return WidgetLibraryService._parse_definition_string(definition)
        raise WidgetValidationError(
            "Définition de widget invalide",
            errors=["La définition du widget doit être un objet JSON."],
        )

    @staticmethod
    def _parse_definition_string(definition: str) -> dict[str, Any]:
        stripped = definition.strip()
        if not stripped:
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["La définition du widget ne peut pas être vide."],
            )

        try:
            parsed = json.loads(stripped)
        except json.JSONDecodeError as exc:
            parsed = WidgetLibraryService._extract_json_object(stripped)
            if parsed is None:
                raise WidgetValidationError(
                    "Définition de widget invalide",
                    errors=["La définition du widget contient une chaîne JSON invalide."],
                ) from exc
        if not isinstance(parsed, dict):
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["La définition du widget doit être un objet JSON."],
            )
        return parsed

    @staticmethod
    def _extract_json_object(definition: str) -> dict[str, Any] | None:
        decoder = json.JSONDecoder()
        for index, char in enumerate(definition):
            if char == "{":
                try:
                    parsed, _end = decoder.raw_decode(definition[index:])
                except json.JSONDecodeError:
                    continue
                if isinstance(parsed, dict):
                    return parsed
        return None

    # -- Intégration vector store -------------------------------------------


    @staticmethod
    def _normalize_text(value: str | None) -> str | None:
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None

    @staticmethod
    def _from_document(document: JsonDocument) -> WidgetTemplateEntry:
        raw = document.raw_document or {}
        if not isinstance(raw, dict):
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["Le document vectoriel ne contient pas un objet JSON."],
            )

        definition = raw.get("definition")
        if isinstance(definition, str):
            definition = WidgetLibraryService._parse_definition_string(definition)
        if not isinstance(definition, dict):
            raise WidgetValidationError(
                "Définition de widget invalide",
                errors=["La définition du widget doit être un objet JSON."],
            )

        return WidgetTemplateEntry(
            slug=str(raw.get("slug") or document.doc_id),
            title=WidgetLibraryService._normalize_text(raw.get("title")),
            description=WidgetLibraryService._normalize_text(raw.get("description")),
            definition=json.loads(json.dumps(definition, ensure_ascii=False)),
            created_at=document.created_at,
            updated_at=document.updated_at,
        )
