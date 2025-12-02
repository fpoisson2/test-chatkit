from __future__ import annotations

import json
import keyword
import logging
import re
import threading
import weakref
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from functools import lru_cache
from typing import Any

from agents import Agent, ModelSettings, ShellTool, WebSearchTool
from agents.extensions.models.litellm_model import LitellmModel
from agents.mcp import MCPServer
from agents.models.interface import ModelProvider
from agents.models.openai_provider import OpenAIProvider
from agents.tool import ComputerTool
from openai import AsyncOpenAI
from pydantic import BaseModel, Field, create_model
from sqlalchemy import select

from ..admin_settings import (
    ResolvedModelProviderCredentials,
    resolve_model_provider_credentials,
    resolve_thread_title_model,
    resolve_thread_title_prompt,
)
from ..chatkit_server.actions import (
    _patch_model_json_schema,
    _remove_additional_properties_from_schema,
    _sanitize_widget_field_name,
    _StrictSchemaBase,
)
from ..config import (
    DEFAULT_THREAD_TITLE_MODEL,
    DEFAULT_THREAD_TITLE_PROMPT,
    ModelProviderConfig,
    get_settings,
)
from ..database import SessionLocal
from ..model_providers._shared import normalize_api_base
from ..models import AvailableModel
from ..token_sanitizer import sanitize_model_like
from ..tool_factory import (
    ResolvedMcpServerContext,
    build_apply_patch_tool,
    build_computer_use_tool,
    build_file_search_tool,
    build_image_generation_tool,
    build_mcp_tool,
    build_weather_tool,
    build_web_search_tool,
    build_widget_validation_tool,
    build_workflow_tool,
    get_mcp_runtime_context,
)

# Import from chatkit for setting computer tool (at module level)
try:
    from chatkit.agents import (
        set_current_computer_tool as _set_chatkit_computer_tool,
        set_debug_session_callback as _set_debug_callback,
    )
    _chatkit_import_success = True
except ImportError as e:
    logging.getLogger("chatkit.server").warning(f"Failed to import chatkit.agents: {e}")
    _set_chatkit_computer_tool = None
    _set_debug_callback = None
    _chatkit_import_success = False

logger = logging.getLogger("chatkit.server")

# Import register_debug_session will be done lazily to avoid circular imports
_debug_callback_initialized = False


def initialize_debug_session_callback() -> None:
    """
    Initialize the debug session callback after the application is fully loaded.
    This is called explicitly from the app startup to avoid circular import issues.
    """
    global _debug_callback_initialized

    if _debug_callback_initialized:
        logger.debug("Debug session callback already initialized, skipping")
        return

    if _set_debug_callback is None:
        logger.warning("Cannot initialize debug callback: chatkit.agents import failed")
        return

    try:
        from app.routes.computer import register_debug_session

        _set_debug_callback(register_debug_session)
        _debug_callback_initialized = True
        logger.info("Computer debug session callback initialized successfully")
    except ImportError as e:
        logger.error(f"Failed to initialize debug session callback - import error: {e}", exc_info=True)
    except Exception as e:
        logger.error(f"Failed to initialize debug session callback - unexpected error: {e}", exc_info=True)
def _model_settings(**kwargs: Any) -> ModelSettings:
    return sanitize_model_like(ModelSettings(**kwargs))


def _clean_model_settings_dict(value: dict) -> dict:
    """Nettoie les valeurs vides/invalides d'un dict model_settings."""
    cleaned = {}
    for k, v in value.items():
        # Ignorer les valeurs vides (None, '', etc.)
        if v is None or v == '':
            continue
        # Traitement récursif pour les dicts imbriqués (ex: reasoning)
        if isinstance(v, dict):
            nested = _clean_model_settings_dict(v)
            if nested:  # Ne garder que si non-vide
                cleaned[k] = nested
        else:
            cleaned[k] = v
    return cleaned


def _coerce_model_settings(value: Any) -> Any:
    if isinstance(value, dict):
        logger.debug("Nettoyage model_settings dict: %s", value)
        # Nettoyer les valeurs vides avant de créer le ModelSettings
        cleaned = _clean_model_settings_dict(value)
        logger.debug("Après nettoyage des valeurs vides: %s", cleaned)
        if not cleaned:
            # Si tout est vide, retourner un ModelSettings vide
            return _model_settings()
        result = _model_settings(**cleaned)
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


@dataclass(frozen=True)
class AgentProviderBinding:
    provider: ModelProvider | None  # None when using LiteLLM auto-routing
    provider_id: str
    provider_slug: str
    credentials: ResolvedModelProviderCredentials | None = None


def _credentials_from_config(
    config: ModelProviderConfig,
) -> ResolvedModelProviderCredentials:
    return ResolvedModelProviderCredentials(
        id=config.id or config.provider,
        provider=config.provider,
        api_base=config.api_base,
        api_key=config.api_key,
    )


@lru_cache(maxsize=16)
def _get_cached_client(
    provider_id: str, api_base: str, api_key: str
) -> AsyncOpenAI:
    return AsyncOpenAI(api_key=api_key, base_url=api_base)


def _build_provider(
    credentials: ResolvedModelProviderCredentials,
) -> ModelProvider | None:
    """
    Build native OpenAI provider if api_base is provided.

    Strategy:
    - If api_base is provided → Create OpenAIProvider for custom endpoint
    - If api_base is not provided → Return None, LiteLLM will auto-route

    This allows using custom/local endpoints with api_base while
    using LiteLLM's auto-routing for standard providers (Groq, Anthropic, etc.)
    """
    api_base = credentials.api_base.strip() if credentials.api_base else ""
    api_key = credentials.api_key.strip() if credentials.api_key else ""

    if not api_key:
        logger.warning(
            "Configuration fournisseur %s (%s) incomplète : clé API manquante",
            credentials.provider,
            credentials.id,
        )
        return None

    # Create native provider if custom api_base is provided
    if api_base:
        normalized_base = normalize_api_base(api_base)
        client = _get_cached_client(credentials.id, normalized_base, api_key)
        return OpenAIProvider(openai_client=client)

    # No api_base - LitellmModel will auto-route based on model name
    return None


# All providers now use the unified _build_provider function with LiteLLM auto-routing


def create_litellm_model(
    model_name: str,
    provider_binding: AgentProviderBinding | None,
) -> LitellmModel | str:
    """
    Create a LitellmModel for auto-routing when no custom api_base is provided.

    This function is only called when provider_binding.provider is None,
    meaning no custom api_base was configured. LiteLLM will auto-route to
    the correct provider (OpenAI, Anthropic, Groq, etc.) based on the model name.

    Args:
        model_name: Model name (e.g., "llama-3.1-8b" or "groq/llama-3.1-8b")
        provider_binding: Provider binding with credentials (no api_base)

    Returns:
        LitellmModel instance with API key for auto-routing, or the
        ``model_name`` string as fallback when a model instance cannot be
        constructed.
    """
    logger.debug(
        "create_litellm_model appelée: model_name=%s, provider_binding=%s",
        model_name,
        provider_binding is not None,
    )

    if provider_binding and provider_binding.credentials:
        api_key = provider_binding.credentials.api_key
        provider_slug = provider_binding.provider_slug

        logger.debug(
            "Credentials trouvées: provider_id=%s, provider_slug=%s, api_key=%s",
            provider_binding.credentials.id,
            provider_slug,
            "***" if api_key else None,
        )

        if api_key:
            # Ajouter le préfixe du provider si nécessaire pour le routage LiteLLM
            effective_model_name = model_name
            if provider_slug and "/" not in model_name:
                # Le nom du modèle n'a pas de préfixe, ajouter le provider_slug
                effective_model_name = f"{provider_slug}/{model_name}"
                logger.debug(
                    "Ajout du préfixe provider au nom du modèle: %s -> %s",
                    model_name,
                    effective_model_name,
                )

            # Create LitellmModel with API key only - auto-routing based on model name
            logger.debug(
                "Création de LitellmModel pour auto-routing: model=%s, api_key=%s",
                effective_model_name,
                "***",
            )
            return LitellmModel(model=effective_model_name, api_key=api_key)
        else:
            logger.warning(
                "api_key vide ou None pour provider_id=%s - retour du nom de modèle",
                provider_binding.credentials.id,
            )
    else:
        logger.warning(
            "provider_binding ou credentials manquant - retour du nom de modèle: "
            "provider_binding=%s, credentials=%s",
            provider_binding is not None,
            provider_binding.credentials if provider_binding else None,
        )

    # Fallback to string model name if no credentials
    return model_name


def get_agent_provider_binding(
    provider_id: str | None, provider_slug: str | None
) -> AgentProviderBinding | None:
    normalized_id = provider_id.strip() if isinstance(provider_id, str) else ""
    normalized_slug = (
        provider_slug.strip().lower() if isinstance(provider_slug, str) else ""
    )

    logger.debug(
        "get_agent_provider_binding appelée: provider_id=%s, provider_slug=%s",
        normalized_id,
        normalized_slug,
    )

    credentials: ResolvedModelProviderCredentials | None = None
    if normalized_id:
        credentials = resolve_model_provider_credentials(normalized_id)
        logger.debug(
            "Après resolve_model_provider_credentials: credentials=%s",
            credentials is not None,
        )

    if credentials is None:
        settings = get_settings()
        if normalized_id:
            for config in settings.model_providers:
                if config.id == normalized_id:
                    credentials = _credentials_from_config(config)
                    logger.debug(
                        "Credentials depuis config par ID: provider=%s",
                        config.provider,
                    )
                    break
        if credentials is None and normalized_slug:
            for config in settings.model_providers:
                if config.provider == normalized_slug:
                    credentials = _credentials_from_config(config)
                    logger.debug(
                        "Credentials depuis config par slug: provider=%s",
                        config.provider,
                    )
                    break

    if credentials is None:
        logger.warning(
            "Aucune credentials trouvée pour provider_id=%s, provider_slug=%s",
            normalized_id,
            normalized_slug,
        )
        return None

    logger.debug(
        "Credentials finales: id=%s, provider=%s, api_key=%s, api_base=%s",
        credentials.id,
        credentials.provider,
        "***" if credentials.api_key else None,
        credentials.api_base,
    )

    slug = normalized_slug or credentials.provider
    # All providers now use LiteLLM with auto-routing
    provider = _build_provider(credentials)

    # Return AgentProviderBinding even if provider is None
    # The credentials are needed for LitellmModel auto-routing
    return AgentProviderBinding(
        provider=provider,  # May be None - LiteLLM handles routing in model
        provider_id=credentials.id,
        provider_slug=slug,
        credentials=credentials,
    )


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
    examples_attr = getattr(model, "__chatkit_examples__", None)
    sanitized_examples: list[Any] = []
    if examples_attr:
        if isinstance(examples_attr, (list, tuple)):
            candidates = list(examples_attr)
        else:
            candidates = [examples_attr]
        for entry in candidates:
            try:
                sanitized_examples.append(
                    json.loads(json.dumps(entry, ensure_ascii=False))
                )
            except Exception as exc:  # pragma: no cover - sérialisation best effort
                logger.debug(
                    "Impossible de sérialiser l'exemple pour le modèle %s: %s",
                    getattr(model, "__name__", model),
                    exc,
                )
    if sanitized_examples:
        schema = dict(schema)
        schema["examples"] = sanitized_examples

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

        if schema_type == "null":
            return type(None), True

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
                tools = build_file_search_tool(entry.get("file_search"))
                if tools is None:
                    continue
                if isinstance(tools, Sequence) and not isinstance(tools, str | bytes):
                    coerced.extend(tools)
                else:
                    coerced.append(tools)
                continue

            if normalized_type == "image_generation":
                logger.debug("Image generation entry avant build: %s", entry)
                tool = build_image_generation_tool(entry)
                logger.debug("Image generation tool après build: %s", tool)
                if tool is not None:
                    coerced.append(tool)
                continue

            if normalized_type in {"computer_use", "computer_use_preview"}:
                tool = build_computer_use_tool(entry)
                if tool is not None:
                    # Check if we should use ShellTool for SSH environment
                    is_ssh = False
                    computer_config = entry.get("computer_use", entry)
                    if isinstance(computer_config, dict):
                        is_ssh = computer_config.get("environment") == "ssh"

                    if is_ssh:
                        # Lazy import to avoid circular dependencies
                        from ..computer.hosted_ssh import HostedSSH
                        from ..computer.shell_executor import SSHShellExecutor

                        if hasattr(tool, "computer") and isinstance(tool.computer, HostedSSH):
                            logger.info("Configuration de ShellTool pour l'environnement SSH")
                            shell_executor = SSHShellExecutor(tool.computer)
                            shell_tool = ShellTool(executor=shell_executor)
                            coerced.append(shell_tool)

                            # Also add ApplyPatchTool for SSH environment
                            logger.info("Configuration de ApplyPatchTool pour l'environnement SSH")
                            apply_patch_tool = build_apply_patch_tool({"ssh": tool.computer})
                            if apply_patch_tool is not None:
                                coerced.append(apply_patch_tool)
                        else:
                            coerced.append(tool)
                    else:
                        coerced.append(tool)

                    # Store computer tool in thread-local for access in agents.py
                    # The debug session will be registered in agents.py when creating the task
                    set_current_computer_tool(tool)
                    if _set_chatkit_computer_tool is not None:
                        _set_chatkit_computer_tool(tool)
                continue

            if normalized_type == "mcp":
                if "mcp" in entry:
                    tool = build_mcp_tool(entry.get("mcp"))
                else:
                    tool = build_mcp_tool(entry)
                coerced.append(tool)
                continue

            if normalized_type == "workflow":
                config: dict[str, Any] = {}
                workflow_payload = entry.get("workflow")
                if isinstance(workflow_payload, Mapping):
                    config.update(workflow_payload)
                elif isinstance(workflow_payload, str):
                    slug_candidate = workflow_payload.strip()
                    if slug_candidate:
                        config["slug"] = slug_candidate
                elif workflow_payload is not None:
                    logger.warning(
                        "Impossible de construire l'outil workflow : "
                        "configuration invalide (%s).",
                        entry,
                    )
                    continue

                for key in (
                    "slug",
                    "workflow_slug",
                    "initial_message",
                    "message",
                    "title",
                    "workflow_title",
                    "identifier",
                    "workflow_identifier",
                    "workflow_id",
                    "id",
                    "name",
                    "description",
                    "show_ui",
                ):
                    if key in config:
                        continue
                    value = entry.get(key)
                    if value is not None:
                        config[key] = value

                slug: str | None = None
                for candidate in (
                    config.get("slug"),
                    config.get("workflow_slug"),
                ):
                    if isinstance(candidate, str):
                        trimmed = candidate.strip()
                        if trimmed:
                            slug = trimmed
                            break

                if slug is None:
                    logger.warning(
                        "Impossible de construire l'outil workflow : slug "
                        "manquant (%s).",
                        config if config else entry,
                    )
                    continue

                config["slug"] = slug

                try:
                    tool = build_workflow_tool(config)
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
        coerced_tools = _coerce_agent_tools(
            merged["tools"], base_kwargs.get("tools") if base_kwargs else None
        )

        normalized_tools: list[Any] = []
        extracted_mcp_servers: list[MCPServer] = []
        resolved_mcp_contexts: list[ResolvedMcpServerContext] = []
        if coerced_tools:
            for tool in coerced_tools:
                if isinstance(tool, MCPServer):
                    extracted_mcp_servers.append(tool)
                    context = get_mcp_runtime_context(tool)
                    if context is not None:
                        resolved_mcp_contexts.append(context)
                elif tool is not None:
                    normalized_tools.append(tool)

        merged["tools"] = normalized_tools
        coerced_tools = normalized_tools

        if extracted_mcp_servers or "mcp_servers" in merged:
            existing_mcp_servers = merged.get("mcp_servers")
            cloned_existing = (
                _clone_tools(existing_mcp_servers)
                if existing_mcp_servers is not None
                else []
            )
            filtered_existing = [
                server for server in cloned_existing if isinstance(server, MCPServer)
            ]
            if extracted_mcp_servers:
                filtered_existing.extend(extracted_mcp_servers)

            # Dédupliquer les serveurs MCP par URL pour éviter les connexions en double
            seen_urls: dict[str, MCPServer] = {}
            deduplicated_servers: list[MCPServer] = []
            for server in filtered_existing:
                params = getattr(server, "params", None)
                if isinstance(params, Mapping):
                    url = params.get("url")
                    if isinstance(url, str) and url.strip():
                        normalized_url = url.strip()
                        if normalized_url not in seen_urls:
                            seen_urls[normalized_url] = server
                            deduplicated_servers.append(server)
                        else:
                            logger.debug(
                                "Serveur MCP en double ignoré (URL=%s)", normalized_url
                            )
                    else:
                        # Serveur sans URL valide, on le garde quand même
                        deduplicated_servers.append(server)
                else:
                    # Serveur sans params, on le garde quand même
                    deduplicated_servers.append(server)

            merged["mcp_servers"] = deduplicated_servers

        if resolved_mcp_contexts:
            merged["mcp_server_contexts"] = list(resolved_mcp_contexts)
            resolved_records = [
                context.record
                for context in resolved_mcp_contexts
                if context.record is not None
            ]
            if resolved_records:
                merged["mcp_server_records"] = resolved_records

            allowlist_entries = [
                {
                    "server_id": context.server_id,
                    "server_url": context.server_url,
                    "tools": list(context.allowlist),
                }
                for context in resolved_mcp_contexts
                if context.allowlist
            ]
            if allowlist_entries:
                merged["mcp_server_allowlists"] = allowlist_entries

        if coerced_tools and any(
            isinstance(tool, ComputerTool) for tool in coerced_tools if tool is not None
        ):
            current_settings = merged.get("model_settings")
            coerced_settings = _coerce_model_settings(current_settings)

            if isinstance(coerced_settings, ModelSettings):
                truncation = getattr(coerced_settings, "truncation", None)
                if truncation != "auto":
                    try:
                        coerced_settings.truncation = "auto"
                    except Exception:  # pragma: no cover - objets immuables
                        try:
                            object.__setattr__(coerced_settings, "truncation", "auto")
                        except Exception:  # pragma: no cover - dernier recours
                            coerced_settings = _model_settings(truncation="auto")
            else:
                coerced_settings = _model_settings(truncation="auto")

            merged["model_settings"] = coerced_settings
    if "response_format" in merged:
        response_format = merged.pop("response_format")

        # Normalize response_format to OpenAI Responses API flat format
        # Expected format: {"type": "json_schema", "name": "...", "schema": {...}, "strict": True}
        if isinstance(response_format, dict):
            fmt_type = response_format.get("type")

            # Check if we have nested format with 'json_schema' key
            # Format: {"type": "json_schema", "json_schema": {"name": "...", "schema": {...}}}
            if fmt_type == "json_schema" and "json_schema" in response_format:
                # Flatten to OpenAI Responses API format
                json_schema_config = response_format.get("json_schema")
                if isinstance(json_schema_config, dict):
                    name = json_schema_config.get("name", "custom_output")
                    schema = json_schema_config.get("schema", {})
                    strict = json_schema_config.get("strict", True)

                    # Ensure schema has 'type' key
                    if isinstance(schema, dict) and "type" not in schema:
                        if "properties" in schema:
                            schema = {"type": "object", **schema}

                    # Convert to flat format
                    response_format = {
                        "type": "json_schema",
                        "name": name,
                        "strict": strict,
                        "schema": schema
                    }
                    logger.debug(
                        "response_format converti au format plat: %s",
                        json.dumps(response_format, ensure_ascii=False)
                    )
            elif "schema" in response_format:
                # Already in flat format or compact format {"name": "...", "schema": {...}}
                schema = response_format.get("schema")
                if isinstance(schema, dict):
                    # Ensure schema has 'type' key
                    if "type" not in schema:
                        if "properties" in schema:
                            schema = {"type": "object", **schema}

                    # Build flat format
                    response_format = {
                        "type": response_format.get("type", "json_schema"),
                        "name": response_format.get("name", "custom_output"),
                        "strict": response_format.get("strict", True),
                        "schema": schema
                    }

                    logger.debug(
                        "response_format normalisé au format plat: %s",
                        json.dumps(response_format, ensure_ascii=False)
                    )

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
AGENT_MCP_METADATA: weakref.WeakKeyDictionary[Agent, dict[str, Any]] = (
    weakref.WeakKeyDictionary()
)
AGENT_COMPUTER_TOOLS: weakref.WeakKeyDictionary[Agent, ComputerTool] = (
    weakref.WeakKeyDictionary()
)

# Thread-local storage for the current computer tool
_thread_local = threading.local()


def set_current_computer_tool(tool: ComputerTool | None) -> None:
    """Set the current computer tool for this thread/request."""
    _thread_local.computer_tool = tool


def get_current_computer_tool() -> ComputerTool | None:
    """Get the current computer tool for this thread/request."""
    return getattr(_thread_local, "computer_tool", None)


def _instantiate_agent(kwargs: dict[str, Any]) -> Agent:
    response_format = kwargs.pop("_response_format_override", None)
    provider_binding = kwargs.pop("_provider_binding", None)
    mcp_server_contexts = kwargs.pop("mcp_server_contexts", None)
    mcp_server_records = kwargs.pop("mcp_server_records", None)
    mcp_server_allowlists = kwargs.pop("mcp_server_allowlists", None)

    # Model and provider logic:
    # - provider_binding.provider exists (api_base provided) → use the native
    #   OpenAI provider.
    # - provider_binding.provider is None (no api_base) → rely on LiteLLM for
    #   auto-routing.
    if "model" in kwargs and provider_binding is not None:
        model_name = kwargs["model"]
        if isinstance(model_name, str):
            if provider_binding.provider is not None:
                # Use native OpenAI provider (api_base was provided)
                logger.debug(
                    "Using native OpenAI provider for model %s with custom base_url",
                    model_name,
                )
                # Provider will be passed via RunConfig in executor
                kwargs.pop("model_provider", None)
            else:
                # Use LiteLLM auto-routing (no api_base provided)
                kwargs["model"] = create_litellm_model(model_name, provider_binding)
                kwargs.pop("model_provider", None)

    # Remove voice/realtime-specific parameters that shouldn't be passed to Agent
    kwargs.pop("voice", None)
    kwargs.pop("realtime", None)
    # Remove model selection UI parameters (only used by frontend composer)
    kwargs.pop("model_selection_mode", None)
    kwargs.pop("user_model_options", None)

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
    if any(
        value is not None
        for value in (mcp_server_contexts, mcp_server_records, mcp_server_allowlists)
    ):
        metadata: dict[str, Any] = {}
        if mcp_server_contexts is not None:
            metadata["contexts"] = mcp_server_contexts
        if mcp_server_records is not None:
            metadata["records"] = mcp_server_records
        if mcp_server_allowlists is not None:
            metadata["allowlists"] = mcp_server_allowlists
        try:
            agent._chatkit_mcp_metadata = metadata
        except Exception:
            logger.debug(
                "Impossible d'attacher les métadonnées MCP à l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
        try:
            AGENT_MCP_METADATA[agent] = metadata
        except Exception:
            logger.debug(
                "Impossible de mémoriser les métadonnées MCP pour l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
    if provider_binding is not None:
        try:
            agent._chatkit_provider_binding = provider_binding
        except Exception:
            logger.debug(
                "Impossible d'attacher provider_binding à l'agent %s",
                getattr(agent, "name", "<inconnu>"),
            )
    return agent


def _load_available_model(model_name: str | None) -> AvailableModel | None:
    if not isinstance(model_name, str):
        return None
    normalized = model_name.strip()
    if not normalized:
        return None
    try:
        session = SessionLocal()
        try:
            return session.scalar(
                select(AvailableModel).where(AvailableModel.name == normalized)
            )
        finally:
            session.close()
    except Exception as exc:  # pragma: no cover - récupération best effort
        logger.debug(
            "Impossible de récupérer le modèle %s pour le fournisseur",
            normalized,
            exc_info=exc,
        )
        return None


def _resolve_agent_provider_binding_for_model(
    model_name: str | None,
) -> AgentProviderBinding | None:
    available_model = _load_available_model(model_name)
    if available_model is None:
        return None

    return get_agent_provider_binding(
        available_model.provider_id, available_model.provider_slug
    )


def _build_thread_title_agent() -> Agent:
    try:
        instructions = resolve_thread_title_prompt()
    except Exception:  # pragma: no cover - configuration best effort
        instructions = DEFAULT_THREAD_TITLE_PROMPT
    try:
        model = resolve_thread_title_model()
    except Exception:  # pragma: no cover - configuration best effort
        model = DEFAULT_THREAD_TITLE_MODEL
    available_model = _load_available_model(model)
    provider_binding = None
    if available_model is not None:
        provider_binding = get_agent_provider_binding(
            available_model.provider_id, available_model.provider_slug
        )

    base_kwargs: dict[str, Any] = {
        "name": "TitreFil",
        "model": model or DEFAULT_THREAD_TITLE_MODEL,
        "instructions": instructions,
        "model_settings": _model_settings(store=False),
    }
    if provider_binding is not None:
        base_kwargs["_provider_binding"] = provider_binding
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
    "AgentProviderBinding",
    "get_agent_provider_binding",
    "create_litellm_model",
    "AGENT_BUILDERS",
    "AGENT_RESPONSE_FORMATS",
    "AGENT_MCP_METADATA",
    "STEP_TITLES",
    "_build_agent_kwargs",
    "_build_custom_agent",
    "_build_thread_title_agent",
    "_resolve_agent_provider_binding_for_model",
    "_coerce_agent_tools",
    "_create_response_format_from_pydantic",
    "_instantiate_agent",
    "initialize_debug_session_callback",
]
