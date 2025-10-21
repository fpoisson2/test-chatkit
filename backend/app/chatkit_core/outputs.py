"""Fonctions d'assistance pour gérer les sorties structurées du workflow."""

from __future__ import annotations

import json
import keyword
import logging
import re
from typing import Any, Mapping

from pydantic import BaseModel, Field, create_model

from backend.app.chatkit_server.actions import (
    _StrictSchemaBase,
    _patch_model_json_schema,
    _remove_additional_properties_from_schema,
    _sanitize_widget_field_name,
)

logger = logging.getLogger(__name__)

_JSON_TYPE_MAPPING: dict[str, Any] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
}


def sanitize_model_name(name: str | None) -> str:
    """Nettoie un nom de modèle JSON Schema pour le rendre compatible Python."""

    candidate = (name or "workflow_output").strip()
    sanitized = re.sub(r"[^0-9a-zA-Z_]", "_", candidate) or "workflow_output"
    if sanitized[0].isdigit():
        sanitized = f"model_{sanitized}"
    return sanitized


def create_response_format_from_pydantic(model: type[BaseModel]) -> dict[str, Any]:
    """Crée un dictionnaire ``response_format`` à partir d'un modèle Pydantic."""

    if hasattr(model, "model_json_schema"):
        schema = model.model_json_schema()
    elif hasattr(model, "schema"):
        schema = model.schema()
    else:
        raise ValueError(f"Cannot generate JSON schema from model {model}")

    schema = _remove_additional_properties_from_schema(schema)
    model_name = getattr(model, "__name__", "Response")
    sanitized_name = sanitize_model_name(model_name)

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
            "response_format demandé (modèle=%s) - impossible de sérialiser pour les logs",
            sanitized_name,
        )

    return response_format


def lookup_known_output_type(name: str) -> type[BaseModel] | None:
    """Retourne un modèle déjà connu du module à partir de son nom."""

    obj = globals().get(name)
    if isinstance(obj, type) and issubclass(obj, BaseModel):
        return obj
    return None


class JsonSchemaOutputBuilder:
    """Convertit un schéma JSON simple en type Python compatible Pydantic."""

    def __init__(self) -> None:
        self._models: dict[str, type[BaseModel]] = {}

    def build_type(self, schema: Any, *, name: str) -> Any | None:
        if not isinstance(schema, dict):
            return None
        py_type, _nullable = self._resolve(schema, sanitize_model_name(name))
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
                return unique_types[0], nullable or option_nullable

            union_type: Any = unique_types[0]
            for extra_type in unique_types[1:]:
                union_type = union_type | extra_type  # type: ignore[operator]
            return union_type, nullable or option_nullable

        if isinstance(schema_type, list):
            types = set(schema_type)
            if "null" in types:
                nullable = True
                types.remove("null")
            if not types:
                return Any, True
            if len(types) == 1:
                schema_type = next(iter(types))
            else:
                resolved_types: list[Any] = []
                for index, option in enumerate(sorted(types), start=1):
                    resolved_type, _ = self._resolve(
                        {"type": option},
                        f"{name}_union_{index}",
                    )
                    resolved_types.append(resolved_type)
                union_type: Any = resolved_types[0]
                for extra_type in resolved_types[1:]:
                    union_type = union_type | extra_type  # type: ignore[operator]
                return union_type, nullable

        if schema.get("const") is not None:
            try:
                from typing import Literal  # local import to éviter import circulaire

                return Literal[schema["const"]], nullable  # type: ignore[index]
            except Exception:  # pragma: no cover
                return Any, nullable

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
        sanitized = sanitize_model_name(name)
        cached = self._models.get(sanitized)
        if cached is not None:
            return cached

        properties = schema.get("properties")
        if not isinstance(properties, dict):
            additional = schema.get("additionalProperties")
            if isinstance(additional, dict):
                value_type, _ = self._resolve(
                    additional,
                    f"{sanitized}Value",
                )
                value_type = value_type if value_type is not None else Any
                return dict[str, value_type]
            if additional:
                return dict[str, Any]
            model = create_model(
                sanitized,
                __module__=__name__,
                __base__=_StrictSchemaBase,
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        if not properties:
            model = create_model(
                sanitized,
                __module__=__name__,
                __base__=_StrictSchemaBase,
            )
            _patch_model_json_schema(model)
            self._models[sanitized] = model
            return model

        sanitized_fields: dict[str, str] = {}
        used_names: set[str] = set()
        for index, prop in enumerate(properties, start=1):
            if not isinstance(prop, str):
                return dict[str, Any]
            if prop.isidentifier() and not keyword.iskeyword(prop) and prop not in used_names:
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

            def _build_field(default: Any) -> Any:
                try:
                    return Field(
                        default,
                        alias=prop_name,
                        serialization_alias=prop_name,
                    )
                except TypeError:  # pragma: no cover - compatibilité Pydantic v1
                    field = Field(default, alias=prop_name)
                    if hasattr(field, "serialization_alias"):
                        try:
                            setattr(field, "serialization_alias", prop_name)
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


def build_output_type_from_response_format(
    response_format: Any,
    *,
    fallback: Any | None,
) -> Any | None:
    """Construit un type Pydantic à partir d'un payload ``response_format``."""

    if not isinstance(response_format, dict):
        logger.warning(
            "Format de réponse agent invalide (type inattendu) : %s. Utilisation du type existant.",
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
        schema_name_raw = json_schema.get("name") if isinstance(json_schema.get("name"), str) else None
        schema_payload = json_schema.get("schema") if isinstance(json_schema.get("schema"), Mapping) else json_schema.get("schema")
    elif json_schema is not None:
        logger.warning(
            "Format JSON Schema invalide (clé 'json_schema' inattendue) pour la configuration agent : %s. Utilisation du type existant.",
            response_format,
        )
        return fallback

    if schema_name_raw is None:
        alt_name = response_format.get("name")
        if isinstance(alt_name, str) and alt_name.strip():
            schema_name_raw = alt_name

    original_name = schema_name_raw if isinstance(schema_name_raw, str) and schema_name_raw.strip() else None
    schema_name = sanitize_model_name(original_name)

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
        known = lookup_known_output_type(original_name)
    if known is None:
        known = lookup_known_output_type(schema_name)
    if known is not None:
        return known

    builder = JsonSchemaOutputBuilder()
    built = builder.build_type(schema_payload, name=schema_name)
    if built is None:
        logger.warning(
            "Impossible de construire un output_type depuis le schéma %s, utilisation du type existant.",
            schema_name,
        )
        return fallback

    return built


def format_step_output(payload: Any) -> str:
    """Formate une sortie de bloc pour l'affichage dans les journaux."""

    if payload is None:
        return "(aucune sortie)"

    if isinstance(payload, BaseModel):
        payload = payload.model_dump()

    if isinstance(payload, (dict, list)):
        try:
            return json.dumps(payload, ensure_ascii=False, indent=2)
        except TypeError:
            return str(payload)

    if isinstance(payload, str):
        text_value = payload.strip()
        if not text_value:
            return "(aucune sortie)"

        try:
            parsed = json.loads(text_value)
        except json.JSONDecodeError:
            return text_value

        if isinstance(parsed, (dict, list)):
            try:
                return json.dumps(parsed, ensure_ascii=False, indent=2)
            except TypeError:
                return str(parsed)
        return str(parsed)

    return str(payload)


def structured_output_as_json(output: Any) -> tuple[Any, str]:
    """Retourne un couple (payload_structuré, représentation texte)."""

    if hasattr(output, "model_dump"):
        try:
            parsed = output.model_dump(by_alias=True)
        except TypeError:
            parsed = output.model_dump()
        return parsed, json.dumps(parsed, ensure_ascii=False)
    if hasattr(output, "dict"):
        try:
            parsed = output.dict(by_alias=True)
        except TypeError:
            parsed = output.dict()
        return parsed, json.dumps(parsed, ensure_ascii=False)
    if isinstance(output, (dict, list)):
        return output, json.dumps(output, ensure_ascii=False)
    return output, str(output)


__all__ = [
    "JsonSchemaOutputBuilder",
    "build_output_type_from_response_format",
    "create_response_format_from_pydantic",
    "format_step_output",
    "lookup_known_output_type",
    "sanitize_model_name",
    "structured_output_as_json",
]
