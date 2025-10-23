from __future__ import annotations

import json
import keyword
import logging
import re
import weakref
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from agents import Agent, ModelSettings, WebSearchTool
from pydantic import BaseModel, Field, create_model

from ..chatkit_server.actions import (
    _patch_model_json_schema,
    _remove_additional_properties_from_schema,
    _sanitize_widget_field_name,
    _StrictSchemaBase,
)
from ..database import SessionLocal
from ..token_sanitizer import sanitize_model_like
from ..tool_factory import (
    build_file_search_tool,
    build_image_generation_tool,
    build_weather_tool,
    build_web_search_tool,
    build_widget_validation_tool,
    build_workflow_tool,
)

logger = logging.getLogger("chatkit.server")
def _model_settings(**kwargs: Any) -> ModelSettings:
    return sanitize_model_like(ModelSettings(**kwargs))


def _coerce_model_settings(value: Any) -> Any:
    if isinstance(value, dict):
        logger.debug("Nettoyage model_settings dict: %s", value)
        result = _model_settings(**value)
        logger.debug(
            "Résultat après nettoyage: %s",
            (
                getattr(result, "model_dump", lambda **_: result)()
                if hasattr(result, "model_dump")
                else result
            ),
        )
        return result
    logger.debug("Nettoyage model_settings objet: %s", value)
    result = sanitize_model_like(value)
    logger.debug(
        "Résultat après nettoyage: %s",
        (
            getattr(result, "model_dump", lambda **_: result)()
            if hasattr(result, "model_dump")
            else result
        ),
    )
    return result


def _clone_tools(value: Sequence[Any] | None) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return list(value)
    if isinstance(value, Sequence) and not isinstance(
        value, str | bytes | bytearray
    ):
        return list(value)
    return [value]


_JSON_TYPE_MAPPING: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def _sanitize_model_name(name: str | None) -> str:
    candidate = (name or "workflow_output").strip()
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "_", candidate) or "workflow_output"
    if sanitized[0].isdigit():
        sanitized = f"model_{sanitized}"
    return sanitized


def _create_response_format_from_pydantic(model: type[BaseModel]) -> dict[str, Any]:
    if hasattr(model, "model_json_schema"):
        schema = model.model_json_schema()
    elif hasattr(model, "schema"):
        schema = model.schema()
    else:
        raise ValueError(f"Cannot generate JSON schema from model {model}")

    schema = _remove_additional_properties_from_schema(schema)

    model_name = getattr(model, "__name__", "Response")
    sanitized_name = _sanitize_model_name(model_name)

    response_format = {
        "type": "json_schema",
        "json_schema": {
            "name": sanitized_name,
            "schema": schema,
            "strict": True,
        },
    }

    try:
        logger.debug(
            "response_format demandé (modèle=%s): %s",
            sanitized_name,
            json.dumps(response_format, ensure_ascii=False),
        )
    except Exception:  # pragma: no cover - sérialisation best effort
        logger.debug(
            "response_format demandé (modèle=%s) - impossible de sérialiser pour "
            "les logs",
            sanitized_name,
        )

    return response_format


def _lookup_known_output_type(name: str) -> type[BaseModel] | None:
    obj = globals().get(name)
    if isinstance(obj, type) and issubclass(obj, BaseModel):
        return obj
    return None


class _JsonSchemaOutputBuilder:
    def __init__(self) -> None:
        self._models: dict[str, type[BaseModel]] = {}

    def build_type(self, schema: Any, *, name: str) -> Any | None:
        if not isinstance(schema, dict):
            return None
        py_type, _nullable = self._resolve(schema, _sanitize_model_name(name))
        return py_type

    def _resolve(self, schema: dict[str, Any], name: str) -> tuple[Any, bool]:
        nullable = False
        schema_type = schema.get("type")

        for combination_key in ("anyOf", "oneOf"):
            options = schema.get(combination_key)
            if not isinstance(options, list) or not options:
                continue

            option_types: list[Any] = []
            option_nullable = False

            for index, option_schema in enumerate(options, start=1):
                if not isinstance(option_schema, dict):
                    return Any, True

                resolved_type, resolved_nullable = self._resolve(
                    option_schema,
                    f"{name}_{combination_key}_{index}",
                )

                if resolved_type is None or resolved_type is Any:
                    return Any, True

                option_types.append(resolved_type)
                if resolved_nullable:
                    option_nullable = True

            if not option_types:
                return Any, True

            unique_types: list[Any] = []
            for candidate in option_types:
                if not any(existing == candidate for existing in unique_types):
                    unique_types.append(candidate)

            if len(unique_types) == 1:
                return unique_types[0], option_nullable

            union_type = unique_types[0]
            for extra in unique_types[1:]:
                union_type = union_type | extra
            return union_type, option_nullable

        if schema_type == "array":
            items_schema = schema.get("items")
            items_type, _ = self._resolve(
                items_schema if isinstance(items_schema, dict) else {},
                f"{name}Item",
            )
            if items_type is None:
                items_type = Any
            return list[items_type], nullable

        if (
            schema_type == "object"
            or "properties" in schema
            or "additionalProperties" in schema
        ):
            return self._build_object(schema, name), nullable

        if isinstance(schema_type, str):
            primitive = _JSON_TYPE_MAPPING.get(schema_type)
            if primitive is not None:
                return primitive, nullable

        return Any, nullable

    def _build_object(self, schema: dict[str, Any], name: str) -> Any:
        sanitized = _sanitize_model_name(name)
        cached = self._models.get(sanitized)
        if cached is not None:
            return cached

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            additional = schema.get("additionalProperties")
            if isinstance(additional, dict):
                value_type, _ = self._resolve(additional, f"{sanitized}Value")
                value_type = value_type if value_type is not None else Any
                return dict[str, value_type]
            if additional:
                return dict[str, Any]
            model = create_model(
                sanitized, __module__=__name__, __base__=_StrictSchemaBase
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        if not properties:
            model = create_model(
                sanitized, __module__=__name__, __base__=_StrictSchemaBase
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        sanitized_fields: dict[str, str] = {}
        used_names: set[str] = set()
        for index, prop in enumerate(properties, start=1):
            if not isinstance(prop, str):
                return dict[str, Any]
            if (
                prop.isidentifier()
                and not keyword.iskeyword(prop)
                and prop not in used_names
            ):
                sanitized_fields[prop] = prop
                used_names.add(prop)
                continue

            field_name = _sanitize_widget_field_name(prop, fallback=f"field_{index}")
            if keyword.iskeyword(field_name):
                field_name = f"{field_name}_"
            if field_name in used_names:
                suffix = 1
                base_name = field_name
                while f"{base_name}_{suffix}" in used_names:
                    suffix += 1
                field_name = f"{base_name}_{suffix}"
            used_names.add(field_name)
            sanitized_fields[prop] = field_name

        required_raw = schema.get("required")
        required: set[str] = set()
        if isinstance(required_raw, list):
            for item in required_raw:
                if isinstance(item, str):
                    required.add(item)

        field_definitions: dict[str, tuple[Any, Any]] = {}
        for prop_name, prop_schema in properties.items():
            nested_schema = prop_schema if isinstance(prop_schema, dict) else {}
            prop_type, prop_nullable = self._resolve(
                nested_schema,
                f"{sanitized}_{prop_name}",
            )
            if prop_type is None:
                prop_type = Any
            field_type = prop_type
            is_required = prop_name in required
            if prop_nullable:
                field_type = field_type | None if field_type is not Any else Any
            field_name = sanitized_fields.get(prop_name)
            if field_name is None:
                return dict[str, Any]

            def _build_field(default: Any, *, alias_name: str = prop_name) -> Any:
                try:
                    return Field(
                        default,
                        alias=alias_name,
                        serialization_alias=alias_name,
                    )
                except TypeError:  # pragma: no cover - compatibilité Pydantic v1
                    field = Field(default, alias=alias_name)
                    if hasattr(field, "serialization_alias"):
                        try:
                            field.serialization_alias = alias_name
                        except Exception:
                            pass
                    return field

            if not is_required:
                if not prop_nullable:
                    field_type = field_type | None if field_type is not Any else Any
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=None),
                )
            else:
                field_definitions[field_name] = (
                    field_type,
                    _build_field(default=Ellipsis),
                )

        model = create_model(
            sanitized,
            __module__=__name__,
            __base__=_StrictSchemaBase,
            **field_definitions,
        )
        _patch_model_json_schema(model)
        self._models[sanitized] = model
        return model


def _build_output_type_from_response_format(
    response_format: Any, *, fallback: Any | None
) -> Any | None:
    if not isinstance(response_format, dict):
        logger.warning(
            "Format de réponse agent invalide (type inattendu) : %s. "
            "Utilisation du type existant.",
            response_format,
        )
        return fallback

    fmt_type = response_format.get("type")
    if fmt_type != "json_schema":
        logger.warning(
            "Format de réponse %s non pris en charge, utilisation du type existant.",
            fmt_type,
        )
        return fallback

    schema_payload: Any | None = None
    schema_name_raw: str | None = None

    json_schema = response_format.get("json_schema")
    if isinstance(json_schema, Mapping):
        schema_name_raw = (
            json_schema.get("name")
            if isinstance(json_schema.get("name"), str)
            else None
        )
        schema_payload = (
            json_schema.get("schema")
            if isinstance(json_schema.get("schema"), Mapping)
            else json_schema.get("schema")
        )
    elif json_schema is not None:
        logger.warning(
            "Format JSON Schema invalide (clé 'json_schema' inattendue) pour la "
            "configuration agent : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    if schema_name_raw is None:
        alt_name = response_format.get("name")
        if isinstance(alt_name, str) and alt_name.strip():
            schema_name_raw = alt_name

    original_name = (
        schema_name_raw
        if isinstance(schema_name_raw, str) and schema_name_raw.strip()
        else None
    )
    schema_name = _sanitize_model_name(original_name)

    if schema_payload is None:
        schema_payload = response_format.get("schema")

    if not isinstance(schema_payload, Mapping):
        logger.warning(
            "Format JSON Schema sans contenu pour %s, utilisation du type existant.",
            schema_name,
        )
        return fallback
    schema_payload = dict(schema_payload)

    known = None
    if original_name:
        known = _lookup_known_output_type(original_name)
    if known is None:
        known = _lookup_known_output_type(schema_name)
    if known is not None:
        return known

    builder = _JsonSchemaOutputBuilder()
    built = builder.build_type(schema_payload, name=schema_name)
    if built is None:
        logger.warning(
            "Impossible de construire un output_type depuis le schéma %s, "
            "utilisation du type existant.",
            schema_name,
        )
        return fallback

    return built


def _coerce_agent_tools(
    value: Any, fallback: Sequence[Any] | None = None
) -> Sequence[Any] | None:
    if value is None:
        return _clone_tools(fallback)

    if not isinstance(value, list):
        return value

    coerced: list[Any] = []
    for entry in value:
        if isinstance(entry, WebSearchTool):
            coerced.append(entry)
            continue

        if isinstance(entry, dict):
            tool_type = entry.get("type") or entry.get("tool") or entry.get("name")
            normalized_type = (
                tool_type.strip().lower() if isinstance(tool_type, str) else ""
            )

            if normalized_type == "web_search":
                tool = build_web_search_tool(entry.get("web_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "file_search":
                tool = build_file_search_tool(entry.get("file_search"))
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "image_generation":
                tool = build_image_generation_tool(entry)
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "workflow":
                workflow_payload = entry.get("workflow")
                if not isinstance(workflow_payload, Mapping):
                    logger.warning(
                        "Impossible de construire l'outil workflow : "
                        "configuration invalide (%s).",
                        entry,
                    )
                    continue

                raw_slug = workflow_payload.get("slug")
                slug = raw_slug.strip() if isinstance(raw_slug, str) else ""
                if not slug:
                    logger.warning(
                        "Impossible de construire l'outil workflow : slug "
                        "manquant (%s).",
                        workflow_payload,
                    )
                    continue

                try:
                    tool = build_workflow_tool(workflow_payload)
                except Exception as exc:  # pragma: no cover - robustesse best effort
                    logger.warning(
                        "Impossible de construire l'outil workflow %r : %s",
                        slug,
                        exc,
                    )
                    continue

                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type == "function":
                function_payload = entry.get("function")
                tool = build_weather_tool(function_payload)
                if tool is None:
                    tool = build_widget_validation_tool(function_payload)
                if tool is not None:
                    coerced.append(tool)
                continue

    if coerced:
        return coerced

    if value:
        logger.warning(
            "Outils agent non reconnus (%s), utilisation de la configuration par "
            "défaut.",
            value,
        )
        return _clone_tools(fallback)

    return []


def _build_response_format_from_widget(
    response_widget: dict[str, Any],
) -> dict[str, Any] | None:
    logger.info(
        "_build_response_format_from_widget appelée avec: %s",
        response_widget,
    )

    if not isinstance(response_widget, dict):
        return None

    source = response_widget.get("source")
    if source != "library":
        logger.debug(
            "response_widget avec source '%s' non géré, seule 'library' est supportée",
            source,
        )
        return None

    slug = response_widget.get("slug")
    if not isinstance(slug, str) or not slug.strip():
        logger.warning(
            "response_widget de type 'library' sans slug valide : %s",
            response_widget,
        )
        return None

    try:
        from .widgets.service import WidgetLibraryService
    except ImportError:
        logger.warning(
            "Impossible d'importer WidgetLibraryService pour traiter response_widget",
        )
        return None

    try:
        session = SessionLocal()
        try:
            widget_service = WidgetLibraryService(session)
            widget_entry = widget_service.get_widget(slug)
        finally:
            session.close()

        if widget_entry is None:
            logger.warning(
                "Widget '%s' introuvable dans la bibliothèque",
                slug,
            )
            return None

        widget_variables = response_widget.get("variables", {})

        logger.debug(
            "Variables extraites du widget '%s': %s (type: %s)",
            slug,
            widget_variables,
            type(widget_variables).__name__,
        )

        properties = {}
        required = []

        for var_path in widget_variables.keys():
            safe_key = _sanitize_widget_field_name(
                var_path, fallback=var_path.replace(".", "_")
            )

            properties[safe_key] = {
                "type": "string",
                "description": f"Valeur pour {var_path}",
            }
            required.append(safe_key)

        logger.debug(
            "Propriétés générées pour le widget '%s': %s",
            slug,
            list(properties.keys()),
        )

        if not properties:
            try:
                from chatkit.widgets import WidgetRoot
            except ImportError:
                logger.warning(
                    "Impossible d'importer WidgetRoot pour générer le schéma du widget",
                )
                return None

            try:
                if hasattr(WidgetRoot, "model_json_schema"):
                    schema = WidgetRoot.model_json_schema()
                elif hasattr(WidgetRoot, "schema"):
                    schema = WidgetRoot.schema()
                else:
                    logger.warning(
                        "Impossible de générer le schéma JSON pour WidgetRoot",
                    )
                    return None

                schema = _remove_additional_properties_from_schema(schema)
            except Exception as exc:
                logger.exception(
                    "Erreur lors de la génération du schéma JSON pour le widget '%s'",
                    slug,
                    exc_info=exc,
                )
                return None
        else:
            schema = {
                "type": "object",
                "properties": properties,
                "required": required,
            }

        widget_name = widget_entry.title or slug
        response_format: dict[str, Any] = {
            "type": "json_schema",
            "name": f"widget_{slug.replace('-', '_')}",
            "schema": schema,
            "strict": True,
        }
        description = widget_entry.description or f"Widget {widget_name}"
        if description:
            response_format["description"] = description

        logger.info(
            "response_format généré depuis le widget de bibliothèque '%s' "
            "(variables: %s)",
            slug,
            list(widget_variables.keys()) if widget_variables else "aucune",
        )
        try:
            logger.debug(
                "response_format demandé pour le widget '%s': %s",
                slug,
                json.dumps(response_format, ensure_ascii=False),
            )
        except Exception:  # pragma: no cover - sérialisation best effort
            logger.debug(
                "response_format demandé pour le widget '%s' - impossible de "
                "sérialiser pour les logs",
                slug,
            )
        return response_format

    except Exception as exc:
        logger.exception(
            "Erreur lors de la récupération du widget '%s' depuis la bibliothèque",
            slug,
            exc_info=exc,
        )
        return None


def _build_agent_kwargs(
    base_kwargs: dict[str, Any], overrides: dict[str, Any] | None
) -> dict[str, Any]:
    merged = {**base_kwargs}
    if overrides:
        for key, value in overrides.items():
            merged[key] = value

    response_widget = merged.pop("response_widget", None)
    sync_output_type = True

    if response_widget is not None and "response_format" not in merged:
        generated_format = _build_response_format_from_widget(response_widget)
        if generated_format is not None:
            merged["response_format"] = generated_format
            merged.pop("output_type", None)
            sync_output_type = False
    if "model_settings" in merged:
        merged["model_settings"] = _coerce_model_settings(merged["model_settings"])
    if "tools" in merged:
        merged["tools"] = _coerce_agent_tools(
            merged["tools"], base_kwargs.get("tools") if base_kwargs else None
        )
    if "response_format" in merged:
        response_format = merged.pop("response_format")
        if sync_output_type:
            output_type = merged.get("output_type")
            resolved = _build_output_type_from_response_format(
                response_format,
                fallback=output_type,
            )
            if resolved is not None:
                merged["output_type"] = resolved
            elif "output_type" not in base_kwargs and "output_type" in merged:
                merged.pop("output_type", None)
        else:
            merged.pop("output_type", None)
        merged["_response_format_override"] = response_format
    return merged


AGENT_RESPONSE_FORMATS: weakref.WeakKeyDictionary[Agent, dict[str, Any]] = (
    weakref.WeakKeyDictionary()
)


def _instantiate_agent(kwargs: dict[str, Any]) -> Agent:
    response_format = kwargs.pop("_response_format_override", None)
    agent = Agent(**kwargs)
    if response_format is not None:
        try:
            agent.response_format = response_format
        except Exception:
            logger.debug(
                "Impossible d'attacher response_format directement à l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            agent._chatkit_response_format = response_format
        except Exception:
            logger.debug(
                "Impossible de stocker _chatkit_response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            AGENT_RESPONSE_FORMATS[agent] = response_format
        except Exception:
            logger.debug(
                "Impossible de mémoriser le response_format pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
    return agent


def _build_thread_title_agent() -> Agent:
    base_kwargs: dict[str, Any] = {
        "name": "TitreFil",
        "model": "gpt-5-nano",
        "instructions": (
            """Propose un titre court et descriptif en français pour un nouveau fil
de discussion.
Utilise au maximum 6 mots."""
        ),
        "model_settings": _model_settings(store=True),
    }
    return _instantiate_agent(_build_agent_kwargs(base_kwargs, None))


_CUSTOM_AGENT_FALLBACK_NAME = "Agent personnalisé"


def _build_custom_agent(overrides: dict[str, Any] | None = None) -> Agent:
    base_kwargs: dict[str, Any] = {"name": _CUSTOM_AGENT_FALLBACK_NAME}
    merged = _build_agent_kwargs(base_kwargs, overrides or {})
    name = merged.get("name")
    if not isinstance(name, str) or not name.strip():
        merged["name"] = _CUSTOM_AGENT_FALLBACK_NAME
    return _instantiate_agent(merged)


AGENT_BUILDERS: dict[str, Callable[[dict[str, Any] | None], Agent]] = {}


STEP_TITLES: dict[str, str] = {}


__all__ = [
    "AGENT_BUILDERS",
    "AGENT_RESPONSE_FORMATS",
    "STEP_TITLES",
    "_build_agent_kwargs",
    "_build_custom_agent",
    "_build_thread_title_agent",
    "_coerce_agent_tools",
    "_create_response_format_from_pydantic",
    "_instantiate_agent",
]
