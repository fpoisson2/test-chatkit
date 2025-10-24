"""Fonctions utilitaires pour la gestion des widgets et actions ChatKit."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Collection, Mapping, Sequence
from dataclasses import dataclass, field, replace
from typing import Any, Literal

from pydantic import BaseModel, Field, create_model

from ..database import SessionLocal
from ..widgets import WidgetLibraryService

logger = logging.getLogger("chatkit.server")


_PYTHON_TYPE_TO_JSON: dict[type[Any], str] = {
    str: "string",
    int: "integer",
    float: "number",
    bool: "boolean",
    type(None): "null",
    list: "array",
    dict: "object",
}


def _infer_json_type(value: Any) -> str | None:
    """Retourne le type JSON Schema correspondant à une valeur Python."""

    for py_type, json_type in _PYTHON_TYPE_TO_JSON.items():
        try:
            if isinstance(value, py_type):
                return json_type
        except TypeError:  # pragma: no cover - cas exotiques non hashables
            continue
    return None


def _ensure_schema_type_information(schema: dict[str, Any]) -> None:
    """Ajoute une clé ``type`` lorsqu'elle peut être déduite d'un schéma."""

    if not isinstance(schema, dict):
        return

    # Traiter récursivement les sous-structures avant de déduire le type.
    properties = schema.get("properties")
    if isinstance(properties, dict):
        for prop_schema in properties.values():
            if isinstance(prop_schema, dict):
                _ensure_schema_type_information(prop_schema)

    items = schema.get("items")
    if isinstance(items, dict):
        _ensure_schema_type_information(items)

    for key in ("allOf", "anyOf", "oneOf"):
        options = schema.get(key)
        if isinstance(options, list):
            for option in options:
                if isinstance(option, dict):
                    _ensure_schema_type_information(option)

    if schema.get("type"):
        return

    candidate_types: list[str] = []

    def _merge_type(value: Any) -> None:
        if isinstance(value, list):
            for entry in value:
                if isinstance(entry, str) and entry not in candidate_types:
                    candidate_types.append(entry)
        elif isinstance(value, str) and value not in candidate_types:
            candidate_types.append(value)

    for key in ("anyOf", "oneOf", "allOf"):
        options = schema.get(key)
        if not isinstance(options, list):
            continue
        for option in options:
            if not isinstance(option, dict):
                continue
            opt_type = option.get("type")
            if opt_type:
                _merge_type(opt_type)
            elif "const" in option:
                inferred = _infer_json_type(option.get("const"))
                if inferred:
                    _merge_type(inferred)
            elif "enum" in option and isinstance(option["enum"], list):
                for enum_value in option["enum"]:
                    inferred = _infer_json_type(enum_value)
                    if inferred:
                        _merge_type(inferred)

    if not candidate_types:
        if "enum" in schema and isinstance(schema["enum"], list):
            for enum_value in schema["enum"]:
                inferred = _infer_json_type(enum_value)
                if inferred:
                    _merge_type(inferred)
        if "const" in schema:
            inferred = _infer_json_type(schema.get("const"))
            if inferred:
                _merge_type(inferred)

    if candidate_types:
        schema["type"] = (
            candidate_types[0] if len(candidate_types) == 1 else candidate_types
        )


def _remove_additional_properties_from_schema(schema: dict[str, Any]) -> dict[str, Any]:
    """
    Supprime récursivement 'additionalProperties' d'un schéma JSON.

    En mode strict, OpenAI Agents SDK interdit 'additionalProperties' -
    le mode strict gère cela automatiquement.

    Args:
        schema: Le schéma JSON à nettoyer

    Returns:
        Le schéma nettoyé (modifié en place)
    """
    if not isinstance(schema, dict):
        return schema

    # Supprimer additionalProperties à ce niveau
    schema.pop("additionalProperties", None)

    # Traiter récursivement les propriétés
    if "properties" in schema and isinstance(schema["properties"], dict):
        for prop_schema in schema["properties"].values():
            if isinstance(prop_schema, dict):
                _remove_additional_properties_from_schema(prop_schema)

    # Traiter récursivement les items (pour les tableaux)
    if "items" in schema and isinstance(schema["items"], dict):
        _remove_additional_properties_from_schema(schema["items"])

    # Traiter récursivement les définitions
    if "definitions" in schema or "$defs" in schema:
        defs = schema.get("definitions") or schema.get("$defs")
        if isinstance(defs, dict):
            for def_schema in defs.values():
                if isinstance(def_schema, dict):
                    _remove_additional_properties_from_schema(def_schema)

    # Traiter allOf, anyOf, oneOf
    for key in ["allOf", "anyOf", "oneOf"]:
        if key in schema and isinstance(schema[key], list):
            for sub_schema in schema[key]:
                if isinstance(sub_schema, dict):
                    _remove_additional_properties_from_schema(sub_schema)

    _ensure_schema_type_information(schema)

    return schema


if hasattr(BaseModel, "model_config"):

    class _StrictSchemaBase(BaseModel):
        """
        Classe de base configurée avec extra=\"forbid\" pour Pydantic v2+.
        """

        model_config = {
            "extra": "forbid",
            "populate_by_name": True,
        }

else:  # pragma: no cover - compatibilité Pydantic v1

    class _StrictSchemaBase(BaseModel):  # type: ignore[no-redef]
        """
        Variante Pydantic v1 configurée pour refuser les champs supplémentaires.
        """

        class Config:
            extra = "forbid"
            allow_population_by_field_name = True
            allow_population_by_alias = True


def _patch_model_json_schema(model: type[BaseModel]) -> None:
    """
    Patcher les méthodes de génération de schéma Pydantic pour garantir
    la compatibilité avec le mode strict de l'Agents SDK.
    """
    if getattr(model, "__chatkit_schema_patched__", False):
        return

    patched = False

    if hasattr(model, "model_json_schema"):
        original_model_json_schema = model.model_json_schema

        @classmethod
        def patched_model_json_schema(cls, *args: Any, **kwargs: Any) -> dict[str, Any]:
            schema = original_model_json_schema(*args, **kwargs)
            return _remove_additional_properties_from_schema(schema)

        model.model_json_schema = patched_model_json_schema  # type: ignore[assignment]
        patched = True

    if hasattr(model, "schema"):
        original_schema = model.schema

        @classmethod
        def patched_schema(cls, *args: Any, **kwargs: Any) -> dict[str, Any]:
            schema = original_schema(*args, **kwargs)
            return _remove_additional_properties_from_schema(schema)

        model.schema = patched_schema  # type: ignore[assignment]
        patched = True

    if hasattr(model, "__get_pydantic_json_schema__"):
        original_get_schema = model.__get_pydantic_json_schema__

        @classmethod
        def patched_get_schema(cls, core_schema: Any, handler: Any) -> dict[str, Any]:
            schema = original_get_schema(core_schema, handler)
            return _remove_additional_properties_from_schema(schema)

        model.__get_pydantic_json_schema__ = patched_get_schema  # type: ignore[assignment]
        patched = True

    if patched:
        model.__chatkit_schema_patched__ = True


@dataclass(frozen=True)
class _WidgetBinding:
    path: tuple[str | int, ...]
    component_type: str | None = None
    sample: str | list[str] | None = None
    value_key: str | None = None


@dataclass(frozen=True)
class _ResponseWidgetConfig:
    source: Literal["library", "variable"]
    slug: str | None
    variables: dict[str, str]
    definition_expression: str | None = None
    await_action: bool | None = None
    output_model: type[BaseModel] | None = None
    bindings: dict[str, _WidgetBinding] = field(default_factory=dict)


def _coerce_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if isinstance(value, int | float):
        return bool(value)
    if isinstance(value, str):
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "on", "oui"}:
            return True
        if normalized in {"false", "0", "no", "off", "non"}:
            return False
    return None


def _parse_response_widget_config(
    parameters: dict[str, Any] | None,
) -> _ResponseWidgetConfig | None:
    """Extrait la configuration de widget depuis les paramètres d'étape."""

    if not parameters or not isinstance(parameters, dict):
        return None

    candidate = parameters.get("response_widget")
    if candidate is None:
        candidate = parameters.get("widget")
    if isinstance(candidate, str):
        slug = candidate.strip()
        if not slug:
            return None
        return _ResponseWidgetConfig(source="library", slug=slug, variables={})

    if not isinstance(candidate, dict):
        return None

    raw_source = candidate.get("source")
    source = raw_source.strip().lower() if isinstance(raw_source, str) else ""
    definition_expression_raw = candidate.get("definition_expression")
    if not isinstance(definition_expression_raw, str):
        definition_expression_raw = candidate.get("definitionExpression")
    definition_expression = (
        definition_expression_raw.strip()
        if isinstance(definition_expression_raw, str)
        else ""
    )
    slug_raw = candidate.get("slug")
    slug = slug_raw.strip() if isinstance(slug_raw, str) else ""

    variables: dict[str, str] = {}
    raw_variables = candidate.get("variables")
    if isinstance(raw_variables, dict):
        for key, expression in raw_variables.items():
            if not isinstance(key, str) or not isinstance(expression, str):
                continue
            trimmed_key = key.strip()
            trimmed_expression = expression.strip()
            if trimmed_key and trimmed_expression:
                variables[trimmed_key] = trimmed_expression

    await_action_value = (
        _coerce_bool(candidate.get("await_action"))
        if "await_action" in candidate
        else _coerce_bool(candidate.get("wait_for_action"))
    )

    if source == "variable" or (not slug and definition_expression):
        if not definition_expression:
            return None
        return _ResponseWidgetConfig(
            source="variable",
            slug=None,
            variables={},
            definition_expression=definition_expression,
            await_action=await_action_value,
        )

    if not slug:
        return None

    return _ResponseWidgetConfig(
        source="library",
        slug=slug,
        variables=variables,
        await_action=await_action_value,
    )


def _sanitize_widget_field_name(candidate: str, *, fallback: str = "value") -> str:
    """Transforme un identifiant de variable en nom de champ valide."""

    normalized = re.sub(r"[^0-9a-zA-Z_]+", "_", candidate).strip("_")
    if not normalized:
        normalized = fallback
    if normalized[0].isdigit():
        normalized = f"_{normalized}"
    return normalized


def _build_widget_output_model(
    slug: str,
    variable_ids: Sequence[str],
    *,
    bindings: Mapping[str, _WidgetBinding] | None = None,
) -> type[BaseModel] | None:
    """Construit un modèle Pydantic correspondant aux variables attendues."""

    unique_variables = [var for var in dict.fromkeys(variable_ids) if var]
    if not unique_variables:
        return None

    field_definitions: dict[str, tuple[Any, Any]] = {}
    used_names: set[str] = set()
    for index, variable_id in enumerate(unique_variables, start=1):
        field_name = _sanitize_widget_field_name(variable_id, fallback=f"field_{index}")
        if field_name in used_names:
            suffix = 1
            base_name = field_name
            while f"{base_name}_{suffix}" in used_names:
                suffix += 1
            field_name = f"{base_name}_{suffix}"
        used_names.add(field_name)
        binding = bindings.get(variable_id) if bindings else None
        description = None
        if binding:
            parts: list[str] = []
            if binding.component_type:
                parts.append(f"Composant : {binding.component_type}")
            sample = binding.sample
            if isinstance(sample, list):
                sample_text = ", ".join(
                    str(item) for item in sample if item is not None
                )
            elif sample is not None:
                sample_text = str(sample)
            else:
                sample_text = None
            if sample_text:
                parts.append(f"Valeur initiale : {sample_text}")
            if parts:
                description = " | ".join(parts)
        try:
            field = Field(
                default=None,
                alias=variable_id,
                serialization_alias=variable_id,
                description=description,
            )
        except TypeError:
            # Compatibilité avec Pydantic v1 qui n'accepte pas serialization_alias.
            field = Field(default=None, alias=variable_id, description=description)
            if hasattr(field, "serialization_alias"):
                try:
                    field.serialization_alias = variable_id
                except Exception:  # pragma: no cover - dépend des versions de Pydantic
                    pass
        annotation = str | list[str] | None
        field_definitions[field_name] = (annotation, field)

    model_name_parts = [
        part.capitalize() for part in re.split(r"[^0-9a-zA-Z]+", slug) if part
    ]
    model_name = "".join(model_name_parts) or "Widget"
    model_name = f"{model_name}Response"

    # Créer une classe de base avec la bonne configuration pour Pydantic v2
    # Cela garantit que le schéma JSON généré sera strict-compatible
    class StrictWidgetBase(_StrictSchemaBase):
        if hasattr(_StrictSchemaBase, "model_config"):
            model_config = {
                **getattr(_StrictSchemaBase, "model_config", {}),
                "populate_by_name": True,
            }

        if hasattr(_StrictSchemaBase, "Config"):  # pragma: no cover - Pydantic v1

            class Config(_StrictSchemaBase.Config):  # type: ignore[misc]
                allow_population_by_field_name = True
                allow_population_by_alias = True

    try:
        widget_model = create_model(
            model_name,
            __base__=StrictWidgetBase,
            __module__=__name__,
            **field_definitions,
        )
    except Exception as exc:  # pragma: no cover - dépend des versions de Pydantic
        logger.warning(
            "Impossible de créer le modèle structuré pour le widget %s: %s", slug, exc
        )
        return None

    # Patcher la génération de schéma pour supprimer additionalProperties
    _patch_model_json_schema(widget_model)

    # Pour Pydantic v1, ajouter la configuration compatible
    if not hasattr(
        widget_model, "model_config"
    ):  # pragma: no cover - compatibilité Pydantic v1
        config = getattr(widget_model, "Config", None)
        if config is None:

            class Config:
                allow_population_by_field_name = True
                allow_population_by_alias = True
                extra = "forbid"

            widget_model.Config = Config
        else:
            config.allow_population_by_field_name = True
            config.allow_population_by_alias = True
            config.extra = "forbid"

    return widget_model


def _load_widget_definition(slug: str, *, context: str) -> Any | None:
    """Charge la définition JSON d'un widget depuis la bibliothèque."""

    try:
        with SessionLocal() as session:
            service = WidgetLibraryService(session)
            template = service.get_widget(slug)
    except Exception as exc:  # pragma: no cover - dépend du stockage
        logger.exception(
            "Impossible de charger le widget %s dans le contexte %s",
            slug,
            context,
            exc_info=exc,
        )
        return None

    if template is None:
        return None

    try:
        return json.loads(json.dumps(template.definition, ensure_ascii=False))
    except Exception as exc:  # pragma: no cover - dépend du SDK installé
        logger.exception(
            "Impossible de sérialiser le widget %s dans le contexte %s",
            slug,
            context,
            exc_info=exc,
        )
        return None


def _extract_template_variables(value: str) -> list[str]:
    """Extrait les variables de template au format {{variable}} d'une chaîne."""
    pattern = r"\{\{([^}]+)\}\}"
    matches = re.findall(pattern, value)
    return [match.strip() for match in matches if match.strip()]


def _collect_widget_bindings(definition: Any) -> dict[str, _WidgetBinding]:
    """Recense les identifiants dynamiques d'un widget et leur position."""

    bindings: dict[str, _WidgetBinding] = {}

    # L'ordre est significatif pour choisir la clé source lors de l'échantillonnage.
    value_keys = (
        "value",
        "text",
        "title",
        "label",
        "caption",
        "description",
        "body",
        "content",
        "heading",
        "subtitle",
        "icon",
        "iconStart",
        "iconEnd",
        "src",
        "alt",
        "href",
        "url",
    )

    manual_paths: set[tuple[str | int, ...]] = set()

    def _format_component_identifier(
        node: Mapping[str, Any],
        value_key: str,
        *,
        existing: Collection[str],
    ) -> str | None:
        component_type = node.get("type")
        if isinstance(component_type, str):
            component_type = component_type.strip()
        else:
            component_type = None

        def _ensure_unique(base: str) -> str:
            if base not in existing:
                return base
            index = 2
            candidate = f"{base}_{index}"
            while candidate in existing:
                index += 1
                candidate = f"{base}_{index}"
            return candidate

        def _from_button() -> str | None:
            if component_type is None or component_type.lower() != "button":
                return None
            key_attr = node.get("key")
            if isinstance(key_attr, str) and key_attr.strip():
                base = key_attr.strip()
            else:
                action = node.get("onClickAction")
                action_id: str | None = None
                if isinstance(action, Mapping):
                    payload = action.get("payload")
                    if isinstance(payload, Mapping):
                        candidate = payload.get("id")
                        if isinstance(candidate, str) and candidate.strip():
                            action_id = candidate.strip()
                base = action_id
            if not base:
                return None
            normalized_base = base
            if value_key in {"label", "text", "title", "value"}:
                return _ensure_unique(normalized_base)
            if value_key in {"icon", "iconStart", "iconEnd"}:
                suffix = "icon" if value_key != "iconEnd" else "icon_end"
                return _ensure_unique(f"{normalized_base}.{suffix}")
            return _ensure_unique(f"{normalized_base}.{value_key}")

        button_identifier = _from_button()
        if button_identifier:
            return button_identifier

        if component_type:
            normalized_type = component_type.lower()
            alias_map = {
                "title": "title",
                "subtitle": "subtitle",
                "heading": "heading",
                "text": "text",
                "caption": "caption",
                "markdown": "markdown",
                "badge": "badge",
                "image": "image",
            }
            alias = alias_map.get(normalized_type)
            if alias and value_key in {
                "value",
                "text",
                "title",
                "label",
                "content",
                "body",
                "src",
                "alt",
                "url",
            }:
                return _ensure_unique(alias)

        name_attr = node.get("name")
        if isinstance(name_attr, str) and name_attr.strip():
            return _ensure_unique(name_attr.strip())

        return None

    def _register(
        identifier: str | None,
        path: tuple[str | int, ...],
        node: dict[str, Any],
        *,
        is_manual: bool,
        value_key: str | None = None,
    ) -> None:
        if not identifier:
            return
        if identifier in bindings:
            return
        if not is_manual:
            duplicate_match = re.match(r"(.+)_([0-9]+)$", identifier)
            if duplicate_match:
                base_identifier = duplicate_match.group(1)
                existing_binding = bindings.get(base_identifier)
                if existing_binding and existing_binding.path == path:
                    return
        if not is_manual and path in manual_paths:
            return
        component_type = node.get("type") if isinstance(node.get("type"), str) else None
        sample: str | list[str] | None = None
        captured_key: str | None = None
        preferred_keys: tuple[str, ...] = (value_key,) if value_key else ()
        candidate_keys = preferred_keys + (
            "value",
            "text",
            "label",
            "title",
            "body",
            "content",
            "heading",
            "subtitle",
            "description",
            "caption",
            "src",
            "url",
            "href",
            "icon",
            "iconStart",
            "iconEnd",
        )
        for candidate_key in candidate_keys:
            if candidate_key not in node:
                continue
            raw_value = node.get(candidate_key)
            if isinstance(raw_value, list):
                sample = [str(item) for item in raw_value]
                captured_key = candidate_key
                break
            if isinstance(raw_value, str | int | float | bool):
                sample = str(raw_value)
                captured_key = candidate_key
                break
        bindings[identifier] = _WidgetBinding(
            path=path,
            component_type=component_type,
            sample=sample,
            value_key=captured_key,
        )
        if is_manual:
            manual_paths.add(path)

    def _walk(node: Any, path: tuple[str | int, ...]) -> None:
        if isinstance(node, dict):
            identifier = node.get("id")
            if isinstance(identifier, str):
                _register(identifier, path, node, is_manual=True)

            editable = node.get("editable")
            if isinstance(editable, dict):
                editable_name = editable.get("name")
                if isinstance(editable_name, str):
                    _register(editable_name, path, node, is_manual=True)
                editable_names = editable.get("names")
                if isinstance(editable_names, list | tuple):
                    for entry in editable_names:
                        if isinstance(entry, str):
                            _register(entry, path, node, is_manual=True)

            name_attr = node.get("name")
            if isinstance(name_attr, str):
                _register(name_attr, path, node, is_manual=True)

            for key in value_keys:
                if key not in node:
                    continue
                raw_value = node[key]
                identifier = _format_component_identifier(
                    node, key, existing=bindings.keys()
                )
                if not identifier:
                    identifier_parts = [str(part) for part in (*path, key) if str(part)]
                    if not identifier_parts:
                        continue
                    identifier = ".".join(identifier_parts)
                if isinstance(raw_value, str | int | float | bool):
                    _register(identifier, path, node, is_manual=False, value_key=key)
                elif isinstance(raw_value, list):
                    simple_values = [
                        str(item)
                        for item in raw_value
                        if isinstance(item, str | int | float | bool)
                    ]
                    if simple_values:
                        _register(
                            identifier,
                            path,
                            node,
                            is_manual=False,
                            value_key=key,
                        )

            for key, child in node.items():
                if isinstance(child, dict | list):
                    _walk(child, (*path, key))
        elif isinstance(node, list):
            for index, entry in enumerate(node):
                if isinstance(entry, dict | list):
                    _walk(entry, (*path, index))

    _walk(definition, ())
    return bindings


def _candidate_widget_keys(*, is_list: bool) -> list[str]:
    base = [
        "value",
        "text",
        "label",
        "title",
        "body",
        "content",
        "heading",
        "subtitle",
        "description",
        "caption",
    ]
    if not is_list:
        base.extend(["icon", "iconStart", "iconEnd"])
    return base


def _sync_button_text_fields(
    node: dict[str, Any],
    text: str,
    *,
    assigned_key: str | None,
    preferred_key: str | None,
    component_type: str | None,
) -> None:
    if not isinstance(text, str):
        return

    candidate_key = assigned_key or preferred_key
    if not candidate_key or candidate_key not in {
        "label",
        "text",
        "title",
        "value",
        "content",
        "body",
    }:
        return

    normalized_type: str | None = None
    for type_candidate in (component_type, node.get("type")):
        if isinstance(type_candidate, str) and type_candidate.strip():
            normalized_type = type_candidate.strip().lower()
            break

    if normalized_type != "button":
        return

    if "label" in node:
        node["label"] = text
    if "text" in node:
        node["text"] = text


def _update_widget_node_value(
    node: dict[str, Any],
    value: str | list[str],
    preferred_key: str | None = None,
    *,
    component_type: str | None = None,
) -> None:
    def _assign(target_key: str, payload: str | list[str]) -> None:
        node[target_key] = payload

    assigned_key: str | None = None

    if isinstance(value, list):
        candidates: list[str | None] = [preferred_key] if preferred_key else []
        candidates.extend(_candidate_widget_keys(is_list=True))
        for key in candidates:
            if key and key in node:
                _assign(key, value)
                return
        _assign("value", value)
        return

    text = value
    candidates = [preferred_key] if preferred_key else []
    candidates.extend(_candidate_widget_keys(is_list=False))
    for key in candidates:
        if key and key in node:
            _assign(key, text)
            assigned_key = key
            break
    else:
        _assign("value", text)
        assigned_key = "value"

    _sync_button_text_fields(
        node,
        text,
        assigned_key=assigned_key,
        preferred_key=preferred_key,
        component_type=component_type,
    )


def _apply_widget_variable_values(
    definition: Any,
    values: dict[str, str | list[str]],
    *,
    bindings: Mapping[str, _WidgetBinding] | None = None,
) -> set[str]:
    matched: set[str] = set()

    def _walk(node: Any, path: tuple[str | int, ...]) -> None:
        if isinstance(node, dict):
            identifier = node.get("id")
            if isinstance(identifier, str) and identifier in values:
                binding = bindings.get(identifier) if bindings else None
                path_matches = not binding or tuple(binding.path) == path
                if path_matches:
                    _update_widget_node_value(
                        node,
                        values[identifier],
                        binding.value_key if binding else None,
                        component_type=binding.component_type if binding else None,
                    )
                    matched.add(identifier)
            editable = node.get("editable")
            if isinstance(editable, dict):
                editable_name = editable.get("name")
                if (
                    isinstance(editable_name, str)
                    and editable_name in values
                    and editable_name not in matched
                ):
                    binding = bindings.get(editable_name) if bindings else None
                    _update_widget_node_value(
                        node,
                        values[editable_name],
                        binding.value_key if binding else None,
                        component_type=binding.component_type if binding else None,
                    )
                    matched.add(editable_name)
                editable_names = editable.get("names")
                if isinstance(editable_names, list):
                    collected = [
                        values[name]
                        for name in editable_names
                        if isinstance(name, str) and name in values
                    ]
                    if collected:
                        _update_widget_node_value(node, collected)
                        matched.update(
                            name
                            for name in editable_names
                            if isinstance(name, str) and name in values
                        )
                elif (
                    isinstance(editable_names, str)
                    and editable_names in values
                    and editable_names not in matched
                ):
                    binding = bindings.get(editable_names) if bindings else None
                    _update_widget_node_value(
                        node,
                        values[editable_names],
                        binding.value_key if binding else None,
                        component_type=binding.component_type if binding else None,
                    )
                    matched.add(editable_names)
            for key, child in node.items():
                if isinstance(child, dict | list):
                    _walk(child, (*path, key))
        elif isinstance(node, list):
            for index, entry in enumerate(node):
                if isinstance(entry, dict | list):
                    _walk(entry, (*path, index))

    _walk(definition, ())

    if bindings:
        for identifier, binding in bindings.items():
            if identifier in matched or identifier not in values:
                continue

            target: Any = definition
            valid_path = True
            for step in binding.path:
                if isinstance(step, str):
                    if not isinstance(target, dict) or step not in target:
                        valid_path = False
                        break
                    target = target[step]
                else:
                    if not isinstance(target, list) or step < 0 or step >= len(target):
                        valid_path = False
                        break
                    target = target[step]

            if not valid_path or not isinstance(target, dict):
                continue

            _update_widget_node_value(
                target,
                values[identifier],
                binding.value_key,
                component_type=binding.component_type,
            )
            matched.add(identifier)

    return matched


_UNSET = object()
"""Sentinelle interne pour différencier absence et mise à jour explicite."""


def _as_mapping(value: Any) -> Mapping[str, Any] | None:
    if isinstance(value, Mapping):
        return value
    return None


def _clone_widget_definition(definition: Any) -> Any | None:
    if definition is None:
        return None
    try:
        return json.loads(json.dumps(definition, ensure_ascii=False))
    except Exception:
        return None


def _json_safe_copy(value: Any) -> Any:
    if isinstance(value, Mapping):
        return {str(key): _json_safe_copy(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(
        value, str | bytes | bytearray
    ):
        return [_json_safe_copy(entry) for entry in value]
    if isinstance(value, str | int | float | bool) or value is None:
        return value
    return str(value)


def _extract_widget_slug(data: Mapping[str, Any]) -> str | None:
    for key in ("slug", "widget_slug", "widgetSlug"):
        raw = data.get(key)
        if isinstance(raw, str) and raw.strip():
            return raw.strip()
    raw_widget = data.get("widget")
    if isinstance(raw_widget, str) and raw_widget.strip():
        return raw_widget.strip()
    return None


def _extract_widget_values(data: Mapping[str, Any]) -> dict[str, Any]:
    values: dict[str, Any] = {}

    def _merge(candidate: Mapping[str, Any]) -> None:
        for key, value in candidate.items():
            if isinstance(key, str):
                trimmed = key.strip()
                if trimmed:
                    values[trimmed] = value

    for value_key in ("values", "variables"):
        candidate = _as_mapping(data.get(value_key))
        if candidate:
            _merge(candidate)

    updates = data.get("updates")
    if isinstance(updates, Sequence):
        for entry in updates:
            candidate = _as_mapping(entry)
            if not candidate:
                continue
            identifier = candidate.get("id")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("identifier")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("binding")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("target")
            if not isinstance(identifier, str) or not identifier.strip():
                identifier = candidate.get("name")
            if isinstance(identifier, str) and identifier.strip():
                values[identifier.strip()] = candidate.get("value")

    return values


def _extract_widget_bindings_from_payload(
    data: Mapping[str, Any],
) -> dict[str, _WidgetBinding]:
    bindings: dict[str, _WidgetBinding] = {}
    raw_bindings = _as_mapping(data.get("bindings"))
    if not raw_bindings:
        return bindings

    for identifier, raw_binding in raw_bindings.items():
        if not isinstance(identifier, str):
            continue
        trimmed = identifier.strip()
        if not trimmed:
            continue
        binding_mapping = _as_mapping(raw_binding)
        if not binding_mapping:
            continue
        path_value = binding_mapping.get("path")
        if not isinstance(path_value, Sequence):
            continue
        normalized_path: list[str | int] = []
        valid_path = True
        for step in path_value:
            if isinstance(step, str):
                normalized_path.append(step)
            elif isinstance(step, int):
                normalized_path.append(step)
            else:
                valid_path = False
                break
        if not valid_path:
            continue
        component_type = binding_mapping.get("component_type")
        if not isinstance(component_type, str):
            component_type = binding_mapping.get("componentType")
            if not isinstance(component_type, str):
                component_type = None
        sample_value = binding_mapping.get("sample")
        sample: str | list[str] | None
        if isinstance(sample_value, Sequence) and not isinstance(
            sample_value, str | bytes | bytearray
        ):
            sample = [
                str(entry)
                for entry in sample_value
                if isinstance(entry, str | int | float | bool)
            ]
        elif sample_value is None:
            sample = None
        else:
            sample = str(sample_value)
        preferred_key = binding_mapping.get("value_key")
        if not isinstance(preferred_key, str):
            preferred_key = binding_mapping.get("valueKey")
        value_key = preferred_key.strip() if isinstance(preferred_key, str) else None

        bindings[trimmed] = _WidgetBinding(
            path=tuple(normalized_path),
            component_type=component_type,
            sample=sample,
            value_key=value_key or None,
        )
    return bindings


def _extract_copy_text_update(data: Mapping[str, Any]) -> object:
    for key in ("copy_text", "copyText"):
        if key in data:
            value = data[key]
            if value is None:
                return None
            if isinstance(value, str | int | float):
                return str(value)
            return _UNSET
    return _UNSET


def _resolve_widget_action_payload(
    payload: Mapping[str, Any],
) -> tuple[str | None, Any | None, dict[str, Any], dict[str, _WidgetBinding], object]:
    container = _as_mapping(payload.get("widget")) or payload

    slug = _extract_widget_slug(container) or _extract_widget_slug(payload)

    definition = _clone_widget_definition(
        container.get("definition")
        or container.get("widget_definition")
        or container.get("widgetDefinition")
    ) or _clone_widget_definition(
        payload.get("definition")
        or payload.get("widget_definition")
        or payload.get("widgetDefinition")
    )

    values = _extract_widget_values(payload)
    if container is not payload:
        values.update(_extract_widget_values(container))

    bindings = _extract_widget_bindings_from_payload(payload)
    if container is not payload:
        bindings.update(_extract_widget_bindings_from_payload(container))

    copy_text = _extract_copy_text_update(container)
    if copy_text is _UNSET:
        copy_text = _extract_copy_text_update(payload)

    return slug, definition, values, bindings, copy_text


def _ensure_widget_output_model(
    config: _ResponseWidgetConfig,
) -> _ResponseWidgetConfig:
    if config.source != "library" or not config.slug:
        logger.debug(
            "_ensure_widget_output_model: config source=%s, slug=%s - "
            "retour sans modèle",
            config.source,
            config.slug,
        )
        return config

    if config.output_model is not None:
        logger.debug(
            "_ensure_widget_output_model: output_model déjà défini pour %s", config.slug
        )
        return config

    logger.debug(
        "_ensure_widget_output_model: Début pour widget '%s', variables=%s",
        config.slug,
        config.variables,
    )

    variable_ids = list(config.variables.keys())
    definition = _load_widget_definition(config.slug, context="configuration")
    if definition is None:
        logger.warning(
            "Widget %s introuvable lors de la préparation du schéma de sortie",
            config.slug,
        )
    else:
        logger.debug(
            "_ensure_widget_output_model: définition chargée pour %s: %s",
            config.slug,
            json.dumps(definition, ensure_ascii=False)[:500],
        )
        bindings = _collect_widget_bindings(definition)
        logger.debug(
            "_ensure_widget_output_model: bindings collectés pour %s: %s",
            config.slug,
            list(bindings.keys()) if bindings else [],
        )
        for identifier in bindings:
            if identifier not in variable_ids:
                variable_ids.append(identifier)
        config = replace(config, bindings=bindings)

    if config.bindings and not variable_ids:
        variable_ids.extend(config.bindings.keys())

    logger.debug(
        "_ensure_widget_output_model: variable_ids finaux pour %s: %s",
        config.slug,
        variable_ids,
    )

    # Si aucune variable n'est trouvée, le widget n'a pas besoin d'output_model
    # (il utilise des valeurs hardcodées directement dans sa définition)
    if not variable_ids:
        logger.debug(
            "_ensure_widget_output_model: Aucune variable trouvée pour %s, "
            "pas besoin d'output_model",
            config.slug,
        )
        return config

    model = _build_widget_output_model(
        config.slug, variable_ids, bindings=config.bindings
    )
    if model is None:
        logger.warning(
            "_ensure_widget_output_model: Impossible de construire le modèle pour %s",
            config.slug,
        )
        return config

    logger.debug(
        "_ensure_widget_output_model: Modèle construit avec succès pour %s: %s",
        config.slug,
        model.__name__,
    )
    return replace(config, output_model=model)


def _should_wait_for_widget_action(
    step_kind: str,
    config: _ResponseWidgetConfig | None,
) -> bool:
    if config is None:
        return False
    if config.await_action is not None:
        return config.await_action
    return step_kind == "widget"


__all__ = [
    "_UNSET",
    "_WidgetBinding",
    "_ResponseWidgetConfig",
    "_coerce_bool",
    "_parse_response_widget_config",
    "_sanitize_widget_field_name",
    "_build_widget_output_model",
    "_load_widget_definition",
    "_extract_template_variables",
    "_collect_widget_bindings",
    "_candidate_widget_keys",
    "_sync_button_text_fields",
    "_update_widget_node_value",
    "_apply_widget_variable_values",
    "_as_mapping",
    "_clone_widget_definition",
    "_json_safe_copy",
    "_extract_widget_slug",
    "_extract_widget_values",
    "_extract_widget_bindings_from_payload",
    "_extract_copy_text_update",
    "_resolve_widget_action_payload",
    "_ensure_widget_output_model",
    "_should_wait_for_widget_action",
    "_remove_additional_properties_from_schema",
    "_StrictSchemaBase",
    "_patch_model_json_schema",
]
