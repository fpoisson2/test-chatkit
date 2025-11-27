from __future__ import annotations

import datetime
import logging
import math
import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import asdict, dataclass
from typing import Any, Literal

from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session, selectinload

from ..admin_settings import (
    apply_appearance_update,
    get_thread_title_prompt_override,
    serialize_appearance_settings,
)
from ..config import Settings, WorkflowDefaults, get_settings
from ..database import SessionLocal
from ..models import (
    AvailableModel,
    HostedWorkflow,
    LTIRegistration,
    Workflow,
    WorkflowAppearance,
    WorkflowDefinition,
    WorkflowStep,
    WorkflowTransition,
    WorkflowViewport,
)
from ..token_sanitizer import sanitize_value

logger = logging.getLogger(__name__)

_TRUTHY_AUTO_START_VALUES = {"true", "1", "yes", "on"}
_FALSY_AUTO_START_VALUES = {"false", "0", "no", "off"}

_LEGACY_AGENT_KEYS = frozenset(
    {
        "triage",
        "triage_2",
        "r_dacteur",
        "get_data_from_web",
        "get_data_from_user",
    }
)
_LEGACY_STATE_SLUGS = frozenset({"maj-etat-triage", "maj-etat-validation"})

_AGENT_NODE_KINDS = frozenset({"agent", "voice_agent"})

_HOSTED_WORKFLOW_SLUG_INVALID_CHARS = re.compile(r"[^0-9a-z_-]+")

_APPEARANCE_ATTRIBUTE_NAMES = (
    "appearance_color_scheme",
    "appearance_radius_style",
    "appearance_accent_color",
    "appearance_use_custom_surface",
    "appearance_surface_hue",
    "appearance_surface_tint",
    "appearance_surface_shade",
    "appearance_heading_font",
    "appearance_body_font",
    "appearance_start_greeting",
    "appearance_start_prompt",
    "appearance_input_placeholder",
    "appearance_disclaimer",
)


def _sanitize_workflow_reference_for_serialization(
    value: Any,
) -> dict[str, Any] | None:
    """Normalise une référence de workflow imbriqué pour la sérialisation."""

    if not isinstance(value, Mapping):
        return None

    sanitized: dict[str, Any] = {}

    raw_id = value.get("id")
    workflow_id: int | None = None
    if isinstance(raw_id, bool):
        workflow_id = None
    elif isinstance(raw_id, int):
        workflow_id = raw_id
    elif isinstance(raw_id, float) and math.isfinite(raw_id):
        workflow_id = int(raw_id)
    elif isinstance(raw_id, str):
        trimmed_id = raw_id.strip()
        if trimmed_id:
            try:
                workflow_id = int(trimmed_id)
            except ValueError:
                workflow_id = None

    if workflow_id is not None and workflow_id > 0:
        sanitized["id"] = workflow_id

    raw_slug = value.get("slug")
    if isinstance(raw_slug, str):
        slug_candidate = raw_slug.strip()
        if slug_candidate:
            sanitized["slug"] = slug_candidate

    if not sanitized:
        return None

    return sanitized


def _coerce_auto_start(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        normalized = value.strip().lower()
        if not normalized:
            return False
        if normalized in _TRUTHY_AUTO_START_VALUES:
            return True
        if normalized in _FALSY_AUTO_START_VALUES:
            return False
        return False
    if isinstance(value, int | float):
        return value != 0
    return False


def resolve_start_auto_start(
    definition: WorkflowDefinition,
) -> bool:
    """Retourne l'option de démarrage automatique du bloc début."""

    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        parameters = step.parameters
        if isinstance(parameters, Mapping):
            raw_value = parameters.get("auto_start")
            if raw_value is None:
                raw_value = parameters.get("start_automatically")
            return _coerce_auto_start(raw_value)
        break

    return False


def resolve_start_auto_start_message(
    definition: WorkflowDefinition,
) -> str:
    """Retourne le message utilisateur injecté lors du démarrage automatique."""

    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        parameters = step.parameters
        if isinstance(parameters, Mapping):
            raw_message = parameters.get("auto_start_user_message")
            if isinstance(raw_message, str):
                return raw_message
        break

    return ""


def resolve_start_auto_start_assistant_message(
    definition: WorkflowDefinition,
) -> str:
    """Retourne le message assistant diffusé lors du démarrage automatique."""

    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        parameters = step.parameters
        if isinstance(parameters, Mapping):
            raw_message = parameters.get("auto_start_assistant_message")
            if isinstance(raw_message, str):
                return raw_message
        break

    return ""


@dataclass(slots=True, frozen=True)
class TelephonyRouteOverrides:
    """Overrides optionnels fournis par la configuration téléphonie."""

    model: str | None
    voice: str | None
    instructions: str | None
    prompt_variables: dict[str, str]
    provider_id: str | None = None
    provider_slug: str | None = None


@dataclass(slots=True, frozen=True)
class TelephonyRouteConfig:
    """Décrit une route de départ téléphonie."""

    label: str | None
    workflow_slug: str | None
    workflow_id: int | None
    phone_numbers: tuple[str, ...]
    prefixes: tuple[str, ...]
    overrides: TelephonyRouteOverrides
    metadata: dict[str, Any]
    priority: int
    is_default: bool = False


@dataclass(slots=True, frozen=True)
class TelephonyStartConfiguration:
    """Configuration complète des routes téléphonie pour le bloc start."""

    routes: tuple[TelephonyRouteConfig, ...]
    default_route: TelephonyRouteConfig | None


@dataclass(slots=True, frozen=True)
class HostedWorkflowConfig:
    """Description normalisée d'un workflow hébergé accessible via le chat."""

    slug: str
    workflow_id: str
    label: str
    description: str | None
    managed: bool = False


def _stringify_hosted_value(value: Any) -> str | None:
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float) and math.isfinite(value):
        normalized = int(value) if float(value).is_integer() else value
        return str(normalized)
    return None


def _normalize_hosted_workflow_slug(value: Any) -> str | None:
    candidate = _stringify_hosted_value(value)
    if candidate is None:
        return None
    normalized = _HOSTED_WORKFLOW_SLUG_INVALID_CHARS.sub("-", candidate.lower())
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-")
    return normalized or None


def _normalize_hosted_workflow_label(value: Any, *, fallback: str) -> str:
    candidate = _stringify_hosted_value(value)
    if candidate is not None:
        return candidate
    return fallback


def _normalize_phone_token(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    if not candidate:
        return None
    normalized = "".join(
        ch for ch in candidate if ch.isdigit() or ch in {"+", "#", "*"}
    )
    return normalized or None


def _normalize_phone_collection(value: Any) -> tuple[str, ...]:
    if isinstance(value, Mapping):
        return ()
    if isinstance(value, str):
        normalized = _normalize_phone_token(value)
        return (normalized,) if normalized else ()
    if not isinstance(value, Sequence):
        return ()
    tokens: list[str] = []
    for item in value:
        normalized = _normalize_phone_token(item)
        if normalized:
            tokens.append(normalized)
    return tuple(dict.fromkeys(tokens))


def _normalize_label(value: Any) -> str | None:
    if isinstance(value, str):
        candidate = value.strip()
        if candidate:
            return candidate
    return None


def _normalize_prompt_variables_payload(payload: Any) -> dict[str, str]:
    if not isinstance(payload, Mapping):
        return {}
    normalized: dict[str, str] = {}
    for key, value in payload.items():
        if not isinstance(key, str):
            continue
        trimmed_key = key.strip()
        if not trimmed_key:
            continue
        if value is None:
            normalized[trimmed_key] = ""
        elif isinstance(value, str):
            normalized[trimmed_key] = value
        else:
            normalized[trimmed_key] = str(value)
    return normalized


def _normalize_route_overrides(payload: Any) -> TelephonyRouteOverrides:
    if not isinstance(payload, Mapping):
        return TelephonyRouteOverrides(None, None, None, {})

    def _sanitize_text(key: str) -> str | None:
        value = payload.get(key)
        if not isinstance(value, str):
            return None
        candidate = value.strip()
        return candidate or None

    prompt_variables = _normalize_prompt_variables_payload(
        payload.get("prompt_variables")
    )
    return TelephonyRouteOverrides(
        _sanitize_text("model"),
        _sanitize_text("voice"),
        _sanitize_text("instructions"),
        prompt_variables,
        _sanitize_text("provider_id"),
        _sanitize_text("provider_slug"),
    )


def _normalize_workflow_reference(payload: Any) -> tuple[str | None, int | None]:
    if isinstance(payload, Mapping):
        slug = payload.get("slug")
        slug_value = slug.strip() if isinstance(slug, str) else None
        workflow_id_raw = payload.get("id")
    else:
        slug_value = payload.strip() if isinstance(payload, str) else None
        workflow_id_raw = None

    workflow_id: int | None = None
    if isinstance(workflow_id_raw, bool):
        workflow_id = None
    elif isinstance(workflow_id_raw, int):
        workflow_id = workflow_id_raw if workflow_id_raw > 0 else None
    elif isinstance(workflow_id_raw, float) and math.isfinite(workflow_id_raw):
        candidate_id = int(workflow_id_raw)
        workflow_id = candidate_id if candidate_id > 0 else None
    elif isinstance(workflow_id_raw, str):
        candidate = workflow_id_raw.strip()
        if candidate:
            try:
                workflow_id = int(candidate)
            except ValueError:
                workflow_id = None

    return slug_value, workflow_id


def _normalize_route_payload(
    payload: Any,
    *,
    priority: int,
    is_default: bool = False,
) -> TelephonyRouteConfig | None:
    if not isinstance(payload, Mapping):
        return None

    label = _normalize_label(payload.get("label"))
    overrides = _normalize_route_overrides(payload.get("overrides"))
    metadata_raw = payload.get("metadata")
    metadata = dict(metadata_raw) if isinstance(metadata_raw, Mapping) else {}

    workflow_payload = payload.get("workflow")
    slug, workflow_id = _normalize_workflow_reference(workflow_payload)
    if slug is None and workflow_id is None:
        slug, workflow_id = _normalize_workflow_reference(payload.get("workflow_slug"))
        if slug is None and workflow_id is None:
            workflow_id_raw = payload.get("workflow_id")
            if isinstance(workflow_id_raw, int) and workflow_id_raw > 0:
                workflow_id = workflow_id_raw

    phone_numbers = _normalize_phone_collection(payload.get("phone_numbers"))
    if not phone_numbers:
        single_number = _normalize_phone_token(payload.get("phone_number"))
        if single_number:
            phone_numbers = (single_number,)

    prefixes = _normalize_phone_collection(payload.get("prefixes"))
    if not prefixes:
        single_prefix = _normalize_phone_token(payload.get("prefix"))
        if single_prefix:
            prefixes = (single_prefix,)

    if not is_default and not phone_numbers and not prefixes:
        return None

    return TelephonyRouteConfig(
        label=label,
        workflow_slug=slug,
        workflow_id=workflow_id,
        phone_numbers=phone_numbers,
        prefixes=prefixes,
        overrides=overrides,
        metadata=metadata,
        priority=priority,
        is_default=is_default,
    )


def resolve_start_telephony_config(
    definition: WorkflowDefinition,
) -> TelephonyStartConfiguration | None:
    """Retourne la configuration téléphonie du bloc start."""

    start_step: WorkflowStep | None = None
    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        start_step = step
        break

    if start_step is None:
        return None

    parameters = getattr(start_step, "parameters", None)
    if not isinstance(parameters, Mapping):
        return None

    telephony_payload = parameters.get("telephony")
    if not isinstance(telephony_payload, Mapping):
        return None

    raw_routes = telephony_payload.get("routes")
    routes_payload = raw_routes if isinstance(raw_routes, Sequence) else []

    routes: list[TelephonyRouteConfig] = []
    priority = 0
    for entry in routes_payload:
        route = _normalize_route_payload(entry, priority=priority)
        priority += 1
        if route is None:
            continue
        routes.append(route)

    default_payload = telephony_payload.get("default")
    default_route = _normalize_route_payload(
        default_payload, priority=priority, is_default=True
    )

    if default_route is None:
        fallback_entry = telephony_payload.get("fallback")
        default_route = _normalize_route_payload(
            fallback_entry, priority=priority, is_default=True
        )

    if not routes and default_route is None:
        return None

    return TelephonyStartConfiguration(
        routes=tuple(routes),
        default_route=default_route,
    )


def resolve_start_hosted_workflows(
    definition: WorkflowDefinition,
) -> tuple[HostedWorkflowConfig, ...]:
    """Retourne la liste des workflows hébergés configurés dans le bloc start."""

    start_step: WorkflowStep | None = None
    for step in definition.steps:
        if getattr(step, "kind", None) != "start":
            continue
        if not getattr(step, "is_enabled", True):
            continue
        start_step = step
        break

    if start_step is None:
        return ()

    parameters = getattr(start_step, "parameters", None)
    if not isinstance(parameters, Mapping):
        return ()

    entries = parameters.get("hosted_workflows")
    if not isinstance(entries, Sequence):
        return ()

    results: list[HostedWorkflowConfig] = []
    seen_slugs: set[str] = set()

    for entry in entries:
        if not isinstance(entry, Mapping):
            continue

        raw_workflow_id = (
            entry.get("workflow_id")
            or entry.get("id")
            or entry.get("workflow")
            or entry.get("remote_id")
        )
        workflow_id = _stringify_hosted_value(raw_workflow_id)
        if workflow_id is None:
            continue

        slug_candidates = (
            entry.get("slug"),
            entry.get("workflow_slug"),
            entry.get("identifier"),
            entry.get("workflow_identifier"),
            entry.get("name"),
        )
        slug: str | None = None
        for candidate in slug_candidates:
            slug = _normalize_hosted_workflow_slug(candidate)
            if slug:
                break
        if slug is None:
            slug = _normalize_hosted_workflow_slug(
                entry.get("label") or entry.get("title") or workflow_id
            )
        if slug is None or slug in seen_slugs:
            continue

        seen_slugs.add(slug)

        label = _normalize_hosted_workflow_label(
            entry.get("label")
            or entry.get("title")
            or entry.get("name")
            or entry.get("workflow_title"),
            fallback=workflow_id,
        )

        description_value = entry.get("description")
        description = (
            description_value.strip()
            if isinstance(description_value, str) and description_value.strip()
            else None
        )

        results.append(
            HostedWorkflowConfig(
                slug=slug,
                workflow_id=workflow_id,
                label=label,
                description=description,
            )
        )

    return tuple(results)


@dataclass(slots=True, frozen=True)
class NormalizedNode:
    slug: str
    kind: str
    display_name: str | None
    agent_key: str | None
    parent_slug: str | None
    is_enabled: bool
    parameters: dict[str, Any]
    metadata: dict[str, Any]


@dataclass(slots=True, frozen=True)
class NormalizedEdge:
    source_slug: str
    target_slug: str
    condition: str | None
    metadata: dict[str, Any]


@dataclass(slots=True, frozen=True)
class WorkflowAppearanceTarget:
    kind: Literal["local", "hosted"]
    workflow_id: int | None
    slug: str
    label: str
    remote_workflow_id: str | None = None


class WorkflowValidationError(ValueError):
    """Exception de validation pour la configuration du workflow."""

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class WorkflowNotFoundError(LookupError):
    """Signale qu'un workflow n'a pas pu être localisé."""

    def __init__(self, workflow_id: int | str) -> None:
        super().__init__(f"Workflow introuvable ({workflow_id})")
        self.workflow_id = workflow_id


class HostedWorkflowNotFoundError(LookupError):
    """Signale qu'un workflow hébergé géré côté serveur est introuvable."""

    def __init__(self, slug: str) -> None:
        super().__init__(f"Workflow hébergé introuvable ({slug})")
        self.slug = slug


class WorkflowVersionNotFoundError(LookupError):
    """Signale qu'une version de workflow est introuvable."""

    def __init__(self, workflow_id: int, version_id: int) -> None:
        super().__init__(
            f"Version {version_id} introuvable pour le workflow {workflow_id}"
        )
        self.workflow_id = workflow_id
        self.version_id = version_id


class WorkflowGraphValidator:
    """Valide et normalise les graphes de workflow."""

    def __init__(self, workflow_defaults: WorkflowDefaults) -> None:
        self._workflow_defaults = workflow_defaults

    def validate_graph_payload(
        self, graph_payload: Mapping[str, Any] | None
    ) -> dict[str, Any]:
        if graph_payload is None:
            payload_dict: dict[str, Any] | None = None
        elif isinstance(graph_payload, Mapping):
            payload_dict = dict(graph_payload)
        else:
            raise WorkflowValidationError(
                "Le graphe de workflow doit être un objet JSON."
            )

        nodes, edges = self.normalize_graph(payload_dict)
        return {
            "nodes": [asdict(node) for node in nodes],
            "edges": [asdict(edge) for edge in edges],
        }

    def normalize_graph(
        self,
        payload: dict[str, Any] | None,
        *,
        allow_empty: bool = False,
    ) -> tuple[list[NormalizedNode], list[NormalizedEdge]]:
        if not payload:
            if allow_empty:
                return self.build_minimal_graph()
            raise WorkflowValidationError("Le workflow doit contenir un graphe valide.")

        raw_nodes = payload.get("nodes") or []
        raw_edges = payload.get("edges") or []
        if not raw_nodes:
            if allow_empty:
                if raw_edges:
                    raise WorkflowValidationError(
                        "Impossible de définir des connexions sans nœuds."
                    )
                return self.build_minimal_graph()
            raise WorkflowValidationError("Le workflow doit contenir au moins un nœud.")

        defaults = self._workflow_defaults

        normalized_nodes: list[NormalizedNode] = []
        slugs: set[str] = set()
        enabled_agent_slugs: set[str] = set()
        enabled_agent_keys: set[str] = set()

        for entry in raw_nodes:
            if not isinstance(entry, dict):
                raise WorkflowValidationError("Chaque nœud doit être un objet JSON.")

            slug = str(entry.get("slug", "")).strip()
            if not slug:
                raise WorkflowValidationError(
                    "Chaque nœud doit posséder un identifiant (slug)."
                )
            if slug in slugs:
                raise WorkflowValidationError(f"Slug dupliqué détecté : {slug}")
            slugs.add(slug)

            kind = str(entry.get("kind", "")).strip().lower()
            if kind not in {
                "start",
                "agent",
                "voice_agent",
                "outbound_call",
                "computer_use",
                "condition",
                "while",
                "state",
                "transform",
                "watch",
                "wait_for_user_input",
                "assistant_message",
                "user_message",
                "json_vector_store",
                "widget",
                "parallel_split",
                "parallel_join",
                "end",
            }:
                raise WorkflowValidationError(
                    f"Type de nœud invalide : {kind or 'inconnu'}"
                )

            agent_key: str | None = None
            if kind in _AGENT_NODE_KINDS:
                raw_agent_key = entry.get("agent_key")
                if raw_agent_key is None:
                    agent_key = None
                elif isinstance(raw_agent_key, str):
                    trimmed_key = raw_agent_key.strip()
                    if trimmed_key:
                        supported_keys = defaults.supported_agent_keys
                        if supported_keys and trimmed_key not in supported_keys:
                            raise WorkflowValidationError(
                                f"Agent inconnu : {trimmed_key}"
                            )
                        agent_key = trimmed_key
                else:
                    raise WorkflowValidationError(
                        f"Le nœud agent {slug} possède une clé d'agent invalide."
                    )

            display_name_raw = entry.get("display_name")
            display_name = (
                str(display_name_raw)
                if display_name_raw is not None and str(display_name_raw).strip()
                else None
            )

            is_enabled = bool(entry.get("is_enabled", True))

            parent_slug_raw = entry.get("parent_slug")
            parent_slug = (
                str(parent_slug_raw).strip()
                if parent_slug_raw is not None and str(parent_slug_raw).strip()
                else None
            )

            parameters = self.ensure_dict(entry.get("parameters"), "paramètres")
            metadata = self.ensure_dict(entry.get("metadata"), "métadonnées")

            if kind in _AGENT_NODE_KINDS and "workflow" in parameters:
                normalized_reference = self.normalize_nested_workflow_reference(
                    parameters.get("workflow"), node_slug=slug
                )
                if normalized_reference is None:
                    parameters.pop("workflow", None)
                else:
                    parameters["workflow"] = normalized_reference

            if kind in _AGENT_NODE_KINDS and "tools" in parameters:
                normalized_tools = self.normalize_agent_tools(
                    parameters.get("tools"), node_slug=f"{slug}.tools"
                )
                if normalized_tools is None:
                    parameters.pop("tools", None)
                else:
                    parameters["tools"] = normalized_tools

            if kind == "parallel_split":
                join_slug_raw = parameters.get("join_slug")
                if join_slug_raw is None:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit préciser la jointure à "
                        "rejoindre."
                    )
                if not isinstance(join_slug_raw, str):
                    raise WorkflowValidationError(
                        f"La jointure du nœud parallel_split {slug} doit être une "
                        "chaîne de caractères."
                    )
                join_slug = join_slug_raw.strip()
                if not join_slug:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit préciser la jointure à "
                        "rejoindre."
                    )
                parameters["join_slug"] = join_slug

                raw_branches = parameters.get("branches")
                if not isinstance(raw_branches, Sequence):
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit définir une liste de "
                        "branches."
                    )

                sanitized_branches: list[dict[str, str]] = []
                for raw_branch in raw_branches:
                    if isinstance(raw_branch, Mapping):
                        branch_slug_raw = raw_branch.get("slug")
                        branch_label_raw = raw_branch.get("label")
                    else:
                        branch_slug_raw = raw_branch
                        branch_label_raw = None

                    branch_slug = (
                        branch_slug_raw.strip()
                        if isinstance(branch_slug_raw, str)
                        else None
                    )
                    if not branch_slug:
                        raise WorkflowValidationError(
                            "Chaque branche parallel_split doit fournir un slug unique."
                        )
                    if branch_slug in slugs:
                        raise WorkflowValidationError(
                            f"Le slug {branch_slug} est déjà utilisé."
                        )
                    if branch_slug in {entry["slug"] for entry in sanitized_branches}:
                        raise WorkflowValidationError(
                            "La branche parallel_split "
                            f"{branch_slug} est déclarée en double."
                        )

                    label = (
                        branch_label_raw.strip()
                        if isinstance(branch_label_raw, str)
                        else None
                    )

                    payload: dict[str, str] = {"slug": branch_slug}
                    if label is not None:
                        payload["label"] = label
                    sanitized_branches.append(payload)

                if len(sanitized_branches) < 2:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit définir au moins deux "
                        "branches."
                    )

                parameters["branches"] = sanitized_branches

            node = NormalizedNode(
                slug=slug,
                kind=kind,
                display_name=display_name,
                agent_key=agent_key,
                parent_slug=parent_slug,
                is_enabled=is_enabled,
                parameters=parameters,
                metadata=metadata,
            )
            normalized_nodes.append(node)

            if node.kind in _AGENT_NODE_KINDS and node.is_enabled:
                enabled_agent_slugs.add(node.slug)
                if node.agent_key:
                    enabled_agent_keys.add(node.agent_key)

        if not any(
            node.kind == "start" and node.is_enabled for node in normalized_nodes
        ):
            raise WorkflowValidationError(
                "Le workflow doit contenir un nœud de début actif."
            )
        normalized_edges: list[NormalizedEdge] = []
        for entry in raw_edges:
            if not isinstance(entry, dict):
                raise WorkflowValidationError(
                    "Chaque connexion doit être un objet JSON."
                )
            source_slug = str(entry.get("source", "")).strip()
            target_slug = str(entry.get("target", "")).strip()
            if not source_slug or not target_slug:
                raise WorkflowValidationError(
                    "Chaque connexion doit préciser source et cible."
                )
            if source_slug not in slugs:
                raise WorkflowValidationError(
                    f"Connexion inconnue : source {source_slug} absente"
                )
            if target_slug not in slugs:
                raise WorkflowValidationError(
                    f"Connexion inconnue : cible {target_slug} absente"
                )

            condition_raw = entry.get("condition")
            if condition_raw is None:
                condition = None
            else:
                condition = str(condition_raw).strip()
                if condition == "":
                    condition = None

            metadata = self.ensure_dict(entry.get("metadata"), "métadonnées")

            normalized_edges.append(
                NormalizedEdge(
                    source_slug=source_slug,
                    target_slug=target_slug,
                    condition=condition,
                    metadata=metadata,
                )
            )

        self.validate_graph_structure(normalized_nodes, normalized_edges)
        return normalized_nodes, normalized_edges

    def build_minimal_graph(self) -> tuple[list[NormalizedNode], list[NormalizedEdge]]:
        end_message = self._workflow_defaults.default_end_message
        nodes = [
            NormalizedNode(
                slug="start",
                kind="start",
                display_name="Début",
                agent_key=None,
                parent_slug=None,
                is_enabled=True,
                parameters={},
                metadata={"position": {"x": 0, "y": 0}},
            ),
            NormalizedNode(
                slug="end",
                kind="end",
                display_name="Fin",
                agent_key=None,
                parent_slug=None,
                is_enabled=True,
                parameters={
                    "message": end_message,
                    "status": {"type": "closed", "reason": end_message},
                },
                metadata={"position": {"x": 320, "y": 0}},
            ),
        ]
        edges = [
            NormalizedEdge(
                source_slug="start",
                target_slug="end",
                condition=None,
                metadata={"label": ""},
            )
        ]
        return nodes, edges

    def ensure_dict(self, value: Any, label: str) -> dict[str, Any]:
        if value is None:
            return {}
        if isinstance(value, BaseModel):
            value = value.model_dump()
        if isinstance(value, Mapping):
            candidate = dict(value)
            sanitized, _removed = sanitize_value(candidate)
            if isinstance(sanitized, dict):
                return sanitized
            return candidate
        raise WorkflowValidationError(f"Les {label} doivent être un objet JSON.")

    def normalize_nested_workflow_reference(
        self, value: Any, *, node_slug: str
    ) -> dict[str, Any] | None:
        if value is None:
            return None
        if isinstance(value, BaseModel):
            value = value.model_dump()
        if not isinstance(value, Mapping):
            raise WorkflowValidationError(
                "La configuration 'workflow' du nœud "
                f"{node_slug} doit être un objet JSON."
            )

        raw_id = value.get("id")
        workflow_id: int | None = None
        if isinstance(raw_id, bool):
            workflow_id = None
        elif isinstance(raw_id, int):
            workflow_id = raw_id
        elif isinstance(raw_id, float) and math.isfinite(raw_id):
            workflow_id = int(raw_id)
        elif isinstance(raw_id, str):
            trimmed_id = raw_id.strip()
            if trimmed_id:
                try:
                    workflow_id = int(trimmed_id)
                except ValueError as exc:
                    raise WorkflowValidationError(
                        "L'identifiant de workflow du nœud "
                        f"{node_slug} doit être un entier."
                    ) from exc
        elif raw_id is not None:
            raise WorkflowValidationError(
                f"L'identifiant de workflow du nœud {node_slug} est invalide."
            )

        if workflow_id is not None and workflow_id <= 0:
            raise WorkflowValidationError(
                "L'identifiant de workflow du nœud "
                f"{node_slug} doit être strictement positif."
            )

        raw_slug = value.get("slug")
        workflow_slug: str | None = None
        if raw_slug is None:
            workflow_slug = None
        elif isinstance(raw_slug, str):
            slug_candidate = raw_slug.strip()
            if not slug_candidate:
                raise WorkflowValidationError(
                    "Le slug de workflow du nœud "
                    f"{node_slug} doit être une chaîne non vide."
                )
            workflow_slug = slug_candidate
        else:
            raise WorkflowValidationError(
                "Le slug de workflow du nœud "
                f"{node_slug} doit être une chaîne de caractères."
            )

        if workflow_id is None and workflow_slug is None:
            raise WorkflowValidationError(
                f"Le nœud {node_slug} doit préciser un identifiant "
                "ou un slug de workflow."
            )

        sanitized: dict[str, Any] = {}
        if workflow_id is not None:
            sanitized["id"] = workflow_id
        if workflow_slug is not None:
            sanitized["slug"] = workflow_slug
        return sanitized

    def normalize_agent_tools(
        self, value: Any, *, node_slug: str
    ) -> list[dict[str, Any]] | None:
        if value is None:
            return None
        if isinstance(value, BaseModel):
            value = value.model_dump()
        if not isinstance(value, Sequence) or isinstance(
            value, str | bytes | bytearray
        ):
            raise WorkflowValidationError(
                "Les outils du nœud "
                f"{node_slug} doivent être fournis sous forme de liste."
            )

        normalized: list[dict[str, Any]] = []
        for index, entry in enumerate(value, start=1):
            tool_label = f"{node_slug}[{index}]"
            current = entry
            if isinstance(current, BaseModel):
                current = current.model_dump()

            if isinstance(current, Mapping):
                sanitized = dict(current)

                tool_type = sanitized.get("type")
                if isinstance(tool_type, str) and tool_type.strip():
                    sanitized["type"] = tool_type.strip()
                else:
                    for alias in ("tool", "name"):
                        alias_value = sanitized.get(alias)
                        if isinstance(alias_value, str) and alias_value.strip():
                            sanitized["type"] = alias_value.strip()
                            break

                workflow_payload = sanitized.get("workflow")
                if isinstance(workflow_payload, BaseModel):
                    workflow_payload = workflow_payload.model_dump()
                elif isinstance(workflow_payload, str):
                    trimmed = workflow_payload.strip()
                    workflow_payload = {"slug": trimmed} if trimmed else None

                if workflow_payload is not None:
                    normalized_reference = self.normalize_nested_workflow_reference(
                        workflow_payload, node_slug=tool_label
                    )
                    if normalized_reference is None:
                        sanitized.pop("workflow", None)
                    else:
                        sanitized["workflow"] = normalized_reference

                normalized.append(sanitized)
                continue

            sanitized_value, _removed = sanitize_value(current)
            if isinstance(sanitized_value, Mapping):
                normalized.append(dict(sanitized_value))
            elif sanitized_value is not None:
                normalized.append(sanitized_value)

        return normalized

    def validate_nested_workflows_for_definition(
        self, nodes: Iterable[NormalizedNode], workflow: Workflow | None
    ) -> None:
        if workflow is None:
            return

        workflow_id = getattr(workflow, "id", None)
        workflow_slug = (getattr(workflow, "slug", "") or "").strip().lower()

        for node in nodes:
            if node.kind not in _AGENT_NODE_KINDS or not node.is_enabled:
                continue
            reference = node.parameters.get("workflow")
            if not isinstance(reference, Mapping):
                continue

            reference_id = reference.get("id") if workflow_id is not None else None
            if isinstance(reference_id, int) and reference_id == workflow_id:
                raise WorkflowValidationError(
                    f"Le nœud {node.slug} ne peut pas exécuter son propre workflow."
                )

            if workflow_slug:
                reference_slug = reference.get("slug")
                if (
                    isinstance(reference_slug, str)
                    and reference_slug.strip().lower() == workflow_slug
                ):
                    raise WorkflowValidationError(
                        f"Le nœud {node.slug} ne peut pas exécuter son propre workflow."
                    )

    def validate_graph_structure(
        self,
        nodes: Iterable[NormalizedNode],
        edges: Iterable[NormalizedEdge],
    ) -> None:
        nodes_by_slug = {node.slug: node for node in nodes if node.is_enabled}
        if not nodes_by_slug:
            raise WorkflowValidationError(
                "Le workflow doit conserver au moins un nœud actif."
            )

        adjacency: dict[str, list[NormalizedEdge]] = {
            slug: [] for slug in nodes_by_slug
        }
        reverse_adjacency: dict[str, list[NormalizedEdge]] = {
            slug: [] for slug in nodes_by_slug
        }
        for edge in edges:
            if (
                edge.source_slug not in nodes_by_slug
                or edge.target_slug not in nodes_by_slug
            ):
                continue
            adjacency[edge.source_slug].append(edge)
            reverse_adjacency[edge.target_slug].append(edge)

        start_nodes = [
            slug for slug, node in nodes_by_slug.items() if node.kind == "start"
        ]
        if not start_nodes:
            raise WorkflowValidationError(
                "Impossible d'identifier le nœud de début actif."
            )
        if len(start_nodes) > 1:
            raise WorkflowValidationError(
                "Un seul nœud de début actif est autorisé dans le workflow."
            )

        end_nodes = [slug for slug, node in nodes_by_slug.items() if node.kind == "end"]

        join_to_split: dict[str, str] = {}

        for slug, node in nodes_by_slug.items():
            outgoing = adjacency.get(slug, [])
            incoming = reverse_adjacency.get(slug, [])
            if node.kind == "start" and incoming:
                raise WorkflowValidationError(
                    "Le nœud de début ne doit pas avoir d'entrée."
                )
            if node.kind == "end" and outgoing:
                raise WorkflowValidationError(
                    "Le nœud de fin ne doit pas avoir de sortie."
                )
            if node.kind == "condition":
                if len(outgoing) < 2:
                    raise WorkflowValidationError(
                        f"Le nœud conditionnel {slug} doit comporter au moins deux "
                        "sorties."
                    )
                seen_branches: set[str] = set()
                default_count = 0
                for edge in outgoing:
                    normalized = (edge.condition or "default").strip().lower()
                    if normalized == "default":
                        default_count += 1
                        if default_count > 1:
                            raise WorkflowValidationError(
                                f"Le nœud conditionnel {slug} ne peut contenir qu'une "
                                "seule branche par défaut."
                            )
                    if normalized in seen_branches:
                        raise WorkflowValidationError(
                            f"Le nœud conditionnel {slug} contient des branches "
                            "conditionnelles en double."
                        )
                    seen_branches.add(normalized)
            if node.kind == "watch":
                if len(incoming) != 1:
                    raise WorkflowValidationError(
                        f"Le bloc watch {slug} doit comporter exactement une entrée."
                    )
            if node.kind == "parallel_split":
                if len(outgoing) < 2:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit comporter au moins deux "
                        "sorties."
                    )
                join_slug_raw = node.parameters.get("join_slug")
                join_slug = (
                    join_slug_raw.strip()
                    if isinstance(join_slug_raw, str)
                    else ""
                )
                if not join_slug:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit préciser une jointure "
                        "associée."
                    )
                join_node = nodes_by_slug.get(join_slug)
                if join_node is None:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} référence une jointure "
                        f"inconnue ({join_slug})."
                    )
                if join_node.kind != "parallel_join":
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit référencer un "
                        "parallel_join valide."
                    )
                if join_slug == slug:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} ne peut pas se rejoindre "
                        "lui-même."
                    )
                if join_slug in join_to_split and join_to_split[join_slug] != slug:
                    raise WorkflowValidationError(
                        f"La jointure {join_slug} est déjà associée au nœud "
                        f"parallel_split {join_to_split[join_slug]}."
                    )
                join_to_split[join_slug] = slug

                branches = node.parameters.get("branches")
                branch_count = len(branches) if isinstance(branches, Sequence) else 0
                if branch_count != len(outgoing):
                    raise WorkflowValidationError(
                        f"Le nœud parallel_split {slug} doit définir autant de "
                        "branches que de sorties."
                    )
            if node.kind == "parallel_join":
                if len(incoming) < 2:
                    raise WorkflowValidationError(
                        f"Le nœud parallel_join {slug} doit comporter au moins deux "
                        "entrées."
                    )

        visited: set[str] = set()
        stack: set[str] = set()

        def dfs(slug: str) -> None:
            if slug in stack:
                raise WorkflowValidationError(
                    "Une boucle a été détectée dans la configuration du workflow."
                )
            if slug in visited:
                return
            stack.add(slug)
            for edge in adjacency.get(slug, []):
                dfs(edge.target_slug)
            stack.remove(slug)
            visited.add(slug)

        dfs(start_nodes[0])

        for end_slug in end_nodes:
            if end_slug not in visited:
                raise WorkflowValidationError(
                    f"Le nœud de fin {end_slug} n'est pas accessible depuis le "
                    "début du workflow."
                )

        for join_slug, node in nodes_by_slug.items():
            if node.kind != "parallel_join":
                continue
            if join_slug not in join_to_split:
                raise WorkflowValidationError(
                    f"Le nœud parallel_join {join_slug} doit être associé à un "
                    "parallel_split."
                )

        reachable_terminals = [slug for slug in visited if not adjacency.get(slug)]
        if not reachable_terminals:
            raise WorkflowValidationError(
                "Le workflow doit comporter au moins une sortie accessible sans "
                "transition."
            )


class WorkflowAppearanceService:
    """Gère les préférences d'apparence des workflows."""

    def __init__(self, session_factory: Callable[[], Session]) -> None:
        self._session_factory = session_factory

    def _get_session(self, session: Session | None) -> tuple[Session, bool]:
        if session is not None:
            return session, False
        return self._session_factory(), True

    def get_workflow_appearance(
        self,
        reference: int | str,
        *,
        session: Session | None = None,
    ) -> dict[str, Any]:
        db, owns_session = self._get_session(session)
        try:
            target = self._resolve_workflow_appearance_target(reference, db)
            override = self._get_workflow_appearance_entry(db, target)
            admin_settings = get_thread_title_prompt_override(db)
            effective = serialize_appearance_settings(admin_settings, override)
            return {
                "target_kind": target.kind,
                "workflow_id": target.workflow_id,
                "workflow_slug": target.slug,
                "label": target.label,
                "remote_workflow_id": target.remote_workflow_id
                if target.kind == "hosted"
                else None,
                "override": self._serialize_workflow_appearance_override(override),
                "effective": effective,
                "inherited_from_global": override is None,
            }
        finally:
            if owns_session:
                db.close()

    def update_workflow_appearance(
        self,
        reference: int | str,
        values: Mapping[str, Any],
        *,
        session: Session | None = None,
    ) -> dict[str, Any]:
        db, owns_session = self._get_session(session)
        try:
            target = self._resolve_workflow_appearance_target(reference, db)
            override = self._get_workflow_appearance_entry(db, target)

            inherit = bool(values.get("inherit_from_global"))
            update_kwargs = {
                key: values[key]
                for key in (
                    "color_scheme",
                    "radius_style",
                    "accent_color",
                    "use_custom_surface_colors",
                    "surface_hue",
                    "surface_tint",
                    "surface_shade",
                    "heading_font",
                    "body_font",
                    "start_screen_greeting",
                    "start_screen_prompt",
                    "start_screen_placeholder",
                    "start_screen_disclaimer",
                )
                if key in values
            }

            if inherit:
                if override is not None:
                    db.delete(override)
                    db.commit()
                return self.get_workflow_appearance(reference, session=db)

            if not update_kwargs and override is None:
                return self.get_workflow_appearance(reference, session=db)

            if override is None:
                override = WorkflowAppearance()
                db.add(override)

            if target.kind == "local":
                override.workflow_id = target.workflow_id
                override.hosted_workflow_slug = None
            else:
                override.workflow_id = None
                override.hosted_workflow_slug = target.slug

            if update_kwargs:
                changed = apply_appearance_update(override, **update_kwargs)
                if changed:
                    override.updated_at = datetime.datetime.now(datetime.UTC)

            if not self._has_appearance_override_values(override):
                db.delete(override)
                db.commit()
                return self.get_workflow_appearance(reference, session=db)

            db.commit()
            db.refresh(override)
            return self.get_workflow_appearance(reference, session=db)
        finally:
            if owns_session:
                db.close()

    def _resolve_workflow_appearance_target(
        self, reference: int | str, session: Session
    ) -> WorkflowAppearanceTarget:
        if isinstance(reference, int):
            workflow = session.get(Workflow, reference)
            if workflow is None:
                raise WorkflowNotFoundError(reference)
            return WorkflowAppearanceTarget(
                kind="local",
                workflow_id=workflow.id,
                slug=workflow.slug,
                label=workflow.display_name,
            )

        normalized_reference = reference.strip().lower()
        workflow = session.scalar(
            select(Workflow).where(Workflow.slug == normalized_reference)
        )
        if workflow is not None:
            return WorkflowAppearanceTarget(
                kind="local",
                workflow_id=workflow.id,
                slug=workflow.slug,
                label=workflow.display_name,
            )

        hosted_by_remote = session.scalar(
            select(HostedWorkflow).where(HostedWorkflow.slug == normalized_reference)
        )
        if hosted_by_remote is not None:
            return WorkflowAppearanceTarget(
                kind="hosted",
                workflow_id=None,
                slug=hosted_by_remote.slug,
                label=hosted_by_remote.label or hosted_by_remote.slug,
                remote_workflow_id=hosted_by_remote.remote_workflow_id,
            )

        raise WorkflowNotFoundError(reference)

    def _get_workflow_appearance_entry(
        self, session: Session, target: WorkflowAppearanceTarget
    ) -> WorkflowAppearance | None:
        if target.kind == "local" and target.workflow_id is not None:
            return session.scalar(
                select(WorkflowAppearance).where(
                    WorkflowAppearance.workflow_id == target.workflow_id
                )
            )

        normalized_slug = target.slug.strip().lower()
        return session.scalar(
            select(WorkflowAppearance).where(
                WorkflowAppearance.hosted_workflow_slug == normalized_slug
            )
        )

    @staticmethod
    def _has_appearance_override_values(override: WorkflowAppearance) -> bool:
        return any(
            getattr(override, attribute, None) is not None
            for attribute in _APPEARANCE_ATTRIBUTE_NAMES
        )

    @staticmethod
    def _serialize_workflow_appearance_override(
        override: WorkflowAppearance | None,
    ) -> dict[str, Any] | None:
        if override is None:
            return None
        return {
            "color_scheme": override.appearance_color_scheme,
            "radius_style": override.appearance_radius_style,
            "accent_color": override.appearance_accent_color,
            "use_custom_surface_colors": override.appearance_use_custom_surface,
            "surface_hue": override.appearance_surface_hue,
            "surface_tint": override.appearance_surface_tint,
            "surface_shade": override.appearance_surface_shade,
            "heading_font": override.appearance_heading_font,
            "body_font": override.appearance_body_font,
            "start_screen_greeting": override.appearance_start_greeting,
            "start_screen_prompt": override.appearance_start_prompt,
            "start_screen_placeholder": override.appearance_input_placeholder,
            "start_screen_disclaimer": override.appearance_disclaimer,
            "created_at": override.created_at,
            "updated_at": override.updated_at,
        }


class WorkflowService:
    """Gestionnaire de persistance pour la configuration du workflow."""

    def __init__(
        self,
        session_factory: Callable[[], Session] | None = None,
        *,
        settings: Settings | None = None,
        workflow_defaults: WorkflowDefaults | None = None,
    ) -> None:
        if settings is None and workflow_defaults is None:
            settings = get_settings()

        self._session_factory = session_factory or SessionLocal
        self._settings = settings
        if workflow_defaults is None:
            if settings is None:
                raise RuntimeError(
                    "Impossible de déterminer la configuration du workflow par défaut."
                )
            workflow_defaults = settings.workflow_defaults
        self._workflow_defaults = workflow_defaults
        self._graph_validator = WorkflowGraphValidator(self._workflow_defaults)
        self._appearance_service = WorkflowAppearanceService(self._session_factory)

    def validate_graph_payload(
        self, graph_payload: Mapping[str, Any] | None
    ) -> dict[str, Any]:
        """Normalise et valide la représentation graphe d'un workflow."""

        return self._graph_validator.validate_graph_payload(graph_payload)

    def _fully_load_definition(
        self, definition: WorkflowDefinition
    ) -> WorkflowDefinition:
        """Charge toutes les relations nécessaires avant fermeture de session."""

        steps = list(definition.steps)
        transitions = list(definition.transitions)
        for transition in transitions:
            _ = transition.source_step  # Force le chargement du nœud source
            _ = transition.target_step  # Force le chargement du nœud cible
        _ = definition.workflow  # Charge le workflow parent avant fermeture

        # Sanitize model_settings in all loaded steps
        for step in steps:
            if step.parameters and isinstance(step.parameters, dict):
                model_settings = step.parameters.get("model_settings")
                if model_settings:
                    sanitized, _removed = sanitize_value(model_settings)
                    if isinstance(sanitized, dict):
                        step.parameters["model_settings"] = sanitized

        return definition

    def _get_session(self, session: Session | None) -> tuple[Session, bool]:
        if session is not None:
            return session, False
        return self._session_factory(), True

    def _resolve_workflow_appearance_target(
        self, reference: int | str, session: Session
    ) -> WorkflowAppearanceTarget:
        if isinstance(reference, int):
            workflow = session.get(Workflow, reference)
            if workflow is None:
                raise WorkflowNotFoundError(reference)
            return WorkflowAppearanceTarget(
                kind="local",
                workflow_id=workflow.id,
                slug=workflow.slug,
                label=workflow.display_name,
            )

        trimmed = str(reference).strip()
        if not trimmed:
            raise WorkflowNotFoundError(reference)

        try:
            numeric_id = int(trimmed)
        except ValueError:
            numeric_id = None

        if numeric_id is not None:
            workflow = session.get(Workflow, numeric_id)
            if workflow is not None:
                return WorkflowAppearanceTarget(
                    kind="local",
                    workflow_id=workflow.id,
                    slug=workflow.slug,
                    label=workflow.display_name,
                )

        normalized_slug = trimmed.lower()
        workflow = session.scalar(
            select(Workflow).where(func.lower(Workflow.slug) == normalized_slug)
        )
        if workflow is not None:
            return WorkflowAppearanceTarget(
                kind="local",
                workflow_id=workflow.id,
                slug=workflow.slug,
                label=workflow.display_name,
            )

        normalized_hosted_slug = _normalize_hosted_workflow_slug(trimmed)
        if normalized_hosted_slug:
            hosted = session.scalar(
                select(HostedWorkflow).where(
                    HostedWorkflow.slug == normalized_hosted_slug
                )
            )
            if hosted is not None:
                return WorkflowAppearanceTarget(
                    kind="hosted",
                    workflow_id=None,
                    slug=hosted.slug,
                    label=hosted.label or hosted.slug,
                    remote_workflow_id=hosted.remote_workflow_id,
                )

        hosted_by_remote = session.scalar(
            select(HostedWorkflow).where(
                HostedWorkflow.remote_workflow_id == trimmed
            )
        )
        if hosted_by_remote is not None:
            return WorkflowAppearanceTarget(
                kind="hosted",
                workflow_id=None,
                slug=hosted_by_remote.slug,
                label=hosted_by_remote.label or hosted_by_remote.slug,
                remote_workflow_id=hosted_by_remote.remote_workflow_id,
            )

        raise WorkflowNotFoundError(reference)

    def _get_workflow_appearance_entry(
        self, session: Session, target: WorkflowAppearanceTarget
    ) -> WorkflowAppearance | None:
        if target.kind == "local" and target.workflow_id is not None:
            return session.scalar(
                select(WorkflowAppearance).where(
                    WorkflowAppearance.workflow_id == target.workflow_id
                )
            )

        normalized_slug = target.slug.strip().lower()
        return session.scalar(
            select(WorkflowAppearance).where(
                WorkflowAppearance.hosted_workflow_slug == normalized_slug
            )
        )

    @staticmethod
    def _has_appearance_override_values(
        override: WorkflowAppearance,
    ) -> bool:
        return any(
            getattr(override, attribute, None) is not None
            for attribute in _APPEARANCE_ATTRIBUTE_NAMES
        )

    @staticmethod
    def _serialize_workflow_appearance_override(
        override: WorkflowAppearance | None,
    ) -> dict[str, Any] | None:
        if override is None:
            return None
        return {
            "color_scheme": override.appearance_color_scheme,
            "radius_style": override.appearance_radius_style,
            "accent_color": override.appearance_accent_color,
            "use_custom_surface_colors": override.appearance_use_custom_surface,
            "surface_hue": override.appearance_surface_hue,
            "surface_tint": override.appearance_surface_tint,
            "surface_shade": override.appearance_surface_shade,
            "heading_font": override.appearance_heading_font,
            "body_font": override.appearance_body_font,
            "start_screen_greeting": override.appearance_start_greeting,
            "start_screen_prompt": override.appearance_start_prompt,
            "start_screen_placeholder": override.appearance_input_placeholder,
            "start_screen_disclaimer": override.appearance_disclaimer,
            "created_at": override.created_at,
            "updated_at": override.updated_at,
        }

    def _get_or_create_default_workflow(self, session: Session) -> Workflow:
        defaults = self._workflow_defaults
        workflow = session.scalar(
            select(Workflow).where(Workflow.slug == defaults.default_workflow_slug)
        )
        if workflow is None:
            existing = session.scalar(
                select(Workflow).order_by(Workflow.created_at.asc())
            )
            if existing is not None:
                workflow = existing
                workflow.slug = defaults.default_workflow_slug
                if not workflow.display_name:
                    workflow.display_name = defaults.default_workflow_display_name
                session.flush()
            else:
                workflow = Workflow(
                    slug=defaults.default_workflow_slug,
                    display_name=defaults.default_workflow_display_name,
                )
                session.add(workflow)
                session.flush()
        return workflow

    def _ensure_default_workflow(self, session: Session) -> Workflow:
        workflow = self._get_or_create_default_workflow(session)
        definition = self._load_active_definition(workflow, session)
        if definition is None:
            self._create_default_definition(session, workflow)
            session.commit()
            session.refresh(workflow)

        has_chatkit_default = session.scalar(
            select(Workflow.id).where(Workflow.is_chatkit_default.is_(True))
        )
        if has_chatkit_default is None:
            workflow.is_chatkit_default = True
            session.add(workflow)
            session.commit()
            session.refresh(workflow)
        return workflow

    def _get_chatkit_workflow(self, session: Session) -> Workflow:
        workflow = session.scalar(
            select(Workflow).where(Workflow.is_chatkit_default.is_(True))
        )
        if workflow is None:
            workflow = self._ensure_default_workflow(session)
        return workflow

    def _load_active_definition(
        self, workflow: Workflow, session: Session
    ) -> WorkflowDefinition | None:
        definition = session.scalar(
            select(WorkflowDefinition)
            .where(
                WorkflowDefinition.workflow_id == workflow.id,
                WorkflowDefinition.is_active.is_(True),
            )
            .order_by(WorkflowDefinition.updated_at.desc())
        )
        if definition is not None:
            return definition
        return session.scalar(
            select(WorkflowDefinition)
            .where(WorkflowDefinition.workflow_id == workflow.id)
            .order_by(WorkflowDefinition.updated_at.desc())
        )

    def _get_next_version(self, workflow: Workflow, session: Session) -> int:
        current = session.scalar(
            select(func.max(WorkflowDefinition.version)).where(
                WorkflowDefinition.workflow_id == workflow.id
            )
        )
        return int(current or 0) + 1

    def _set_active_definition(
        self, workflow: Workflow, definition: WorkflowDefinition, session: Session
    ) -> None:
        session.execute(
            update(WorkflowDefinition)
            .where(
                WorkflowDefinition.workflow_id == workflow.id,
                WorkflowDefinition.id != definition.id,
            )
            .values(is_active=False)
        )
        definition.is_active = True
        workflow.active_version_id = definition.id
        session.flush()

    def _replace_definition_graph(
        self,
        definition: WorkflowDefinition,
        *,
        nodes: list[NormalizedNode],
        edges: list[NormalizedEdge],
        session: Session,
    ) -> WorkflowDefinition:
        self._graph_validator.validate_nested_workflows_for_definition(
            nodes, definition.workflow
        )

        # Extraire et mettre à jour le sip_account_id
        sip_account_id = self._extract_sip_account_id_from_nodes(nodes)
        definition.sip_account_id = sip_account_id

        definition.transitions[:] = []
        session.flush()
        definition.steps[:] = []
        session.flush()

        slug_to_step: dict[str, WorkflowStep] = {}
        for index, node in enumerate(nodes, start=1):
            step = WorkflowStep(
                slug=node.slug,
                kind=node.kind,
                display_name=node.display_name,
                agent_key=node.agent_key,
                parent_slug=node.parent_slug,
                position=index,
                is_enabled=node.is_enabled,
                parameters=dict(node.parameters),
                ui_metadata=dict(node.metadata),
            )
            definition.steps.append(step)
            slug_to_step[node.slug] = step

        for edge in edges:
            definition.transitions.append(
                WorkflowTransition(
                    source_step=slug_to_step[edge.source_slug],
                    target_step=slug_to_step[edge.target_slug],
                    condition=edge.condition,
                    ui_metadata=dict(edge.metadata),
                )
            )

        session.flush()
        return definition

    def _extract_sip_account_id_from_nodes(
        self, nodes: list[NormalizedNode]
    ) -> int | None:
        """Extrait l'ID du compte SIP depuis le noeud start."""
        for node in nodes:
            if node.kind == "start" and node.parameters:
                telephony = node.parameters.get("telephony")
                if isinstance(telephony, dict):
                    sip_account_id = telephony.get("sip_account_id")
                    if isinstance(sip_account_id, int) and sip_account_id > 0:
                        return sip_account_id
        return None

    def _create_definition_from_graph(
        self,
        *,
        workflow: Workflow,
        nodes: list[NormalizedNode],
        edges: list[NormalizedEdge],
        session: Session,
        name: str | None = None,
        mark_active: bool = False,
    ) -> WorkflowDefinition:
        version_number = self._get_next_version(workflow, session)

        # Extraire le sip_account_id du graph
        sip_account_id = self._extract_sip_account_id_from_nodes(nodes)

        definition = WorkflowDefinition(
            workflow=workflow,
            name=name or f"v{version_number}",
            version=version_number,
            is_active=False,
            sip_account_id=sip_account_id,
        )
        session.add(definition)
        session.flush()

        self._replace_definition_graph(
            definition,
            nodes=nodes,
            edges=edges,
            session=session,
        )
        if mark_active:
            self._set_active_definition(workflow, definition, session)

        return definition

    def get_current(self, session: Session | None = None) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            workflow = self._get_chatkit_workflow(db)
            definition = self._load_active_definition(workflow, db)
            if definition is None:
                definition = self._create_default_definition(db, workflow)
                db.commit()
                db.refresh(definition)
            definition = self._fully_load_definition(definition)
            if self._needs_graph_backfill(definition):
                logger.info(
                    "Legacy workflow detected, backfilling default graph with existing "
                    "agent configuration",
                )
                definition = self._backfill_legacy_definition(definition, db)
                self._set_active_definition(workflow, definition, db)
                db.commit()
            return definition
        finally:
            if owns_session:
                db.close()

    def get_definition_by_slug(
        self, slug: str, session: Session | None = None
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            normalized_slug = slug.strip()
            if not normalized_slug:
                raise WorkflowValidationError(
                    "Le slug du workflow ne peut pas être vide."
                )

            defaults = self._workflow_defaults
            if normalized_slug == defaults.default_workflow_slug:
                workflow = self._ensure_default_workflow(db)
            else:
                workflow = db.scalar(
                    select(Workflow).where(Workflow.slug == normalized_slug)
                )
                if workflow is None:
                    raise WorkflowValidationError(
                        f"Workflow introuvable pour le slug {normalized_slug!r}."
                    )

            definition = self._load_active_definition(workflow, db)
            if definition is None:
                raise WorkflowValidationError(
                    "Aucune version active n'est disponible pour ce workflow."
                )

            definition = self._fully_load_definition(definition)
            if self._needs_graph_backfill(definition):
                logger.info(
                    "Legacy workflow detected, backfilling default graph for slug %s",
                    normalized_slug,
                )
                definition = self._backfill_legacy_definition(definition, db)
                self._set_active_definition(workflow, definition, db)
                db.commit()

            return definition
        finally:
            if owns_session:
                db.close()

    def get_sip_workflow(
        self, session: Session | None = None, sip_account_id: int | None = None
    ) -> WorkflowDefinition | None:
        """Cherche le workflow associé à un compte SIP.

        Args:
            session: Session SQLAlchemy (optionnelle)
            sip_account_id: ID du compte SIP pour lequel trouver le workflow.
                Si None, cherche le workflow avec is_sip_workflow=true
                (comportement legacy).

        Returns:
            La définition du workflow associée au compte SIP, ou None si aucune.
        """
        db, owns_session = self._get_session(session)
        try:
            # Nouvelle logique: chercher par sip_account_id
            if sip_account_id is not None:
                # Trouver la définition active associée à ce compte SIP
                from ..models import WorkflowDefinition

                definition = db.scalar(
                    select(WorkflowDefinition)
                    .where(
                        WorkflowDefinition.sip_account_id == sip_account_id,
                        WorkflowDefinition.is_active.is_(True),
                    )
                )

                if definition is not None:
                    definition = self._fully_load_definition(definition)
                    if self._needs_graph_backfill(definition):
                        workflow = definition.workflow
                        logger.info(
                            "Legacy SIP workflow detected, "
                            "backfilling default graph for slug %s",
                            workflow.slug,
                        )
                        definition = self._backfill_legacy_definition(definition, db)
                        self._set_active_definition(workflow, definition, db)
                        db.commit()
                    return definition

                # Aucun workflow trouvé pour ce compte SIP
                logger.warning(
                    "Aucun workflow actif trouvé pour le compte SIP ID=%d",
                    sip_account_id,
                )
                return None

            # Comportement legacy: chercher is_sip_workflow=true
            # Chercher tous les workflows actifs
            workflows = db.scalars(select(Workflow)).all()

            for workflow in workflows:
                definition = self._load_active_definition(workflow, db)
                if definition is None:
                    continue

                # Vérifier si ce workflow a is_sip_workflow=true
                for step in definition.steps:
                    if step.kind == "start" and step.parameters:
                        telephony = step.parameters.get("telephony", {})
                        if (
                            isinstance(telephony, dict)
                            and telephony.get("is_sip_workflow") is True
                        ):
                            definition = self._fully_load_definition(definition)
                            if self._needs_graph_backfill(definition):
                                logger.info(
                                    "Legacy SIP workflow detected, "
                                    "backfilling default graph for slug %s",
                                    workflow.slug,
                                )
                                definition = self._backfill_legacy_definition(
                                    definition, db
                                )
                                self._set_active_definition(workflow, definition, db)
                                db.commit()
                            return definition

            # Aucun workflow SIP trouvé
            return None
        finally:
            if owns_session:
                db.close()

    def update_current(
        self,
        graph_payload: dict[str, Any],
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            normalized_nodes, normalized_edges = self._graph_validator.normalize_graph(
                graph_payload
            )
            workflow = self._get_chatkit_workflow(db)
            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=normalized_nodes,
                edges=normalized_edges,
                session=db,
                mark_active=True,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def _create_default_definition(
        self, session: Session, workflow: Workflow
    ) -> WorkflowDefinition:
        nodes, edges = self._graph_validator.normalize_graph(
            self._workflow_defaults.clone_workflow_graph()
        )
        definition = self._create_definition_from_graph(
            workflow=workflow,
            nodes=nodes,
            edges=edges,
            session=session,
            name="Version initiale",
            mark_active=True,
        )
        session.commit()
        session.refresh(definition)
        return self._fully_load_definition(definition)

    def list_workflows(self, session: Session | None = None) -> list[Workflow]:
        db, owns_session = self._get_session(session)
        try:
            self._ensure_default_workflow(db)
            workflows = db.scalars(
                select(Workflow).order_by(Workflow.created_at.asc())
            ).all()
            for workflow in workflows:
                _ = workflow.versions  # force le chargement des versions
            return workflows
        finally:
            if owns_session:
                db.close()

    def set_chatkit_workflow(
        self, workflow_id: int, session: Session | None = None
    ) -> Workflow:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            if workflow.active_version_id is None:
                raise WorkflowValidationError(
                    "Définissez une version de production avant d'utiliser ce workflow "
                    "avec ChatKit."
                )

            has_changed = False
            workflows = db.scalars(select(Workflow)).all()
            for current in workflows:
                should_be_default = current.id == workflow_id
                if current.is_chatkit_default != should_be_default:
                    current.is_chatkit_default = should_be_default
                    has_changed = True
                    db.add(current)

            if has_changed:
                db.commit()
                db.refresh(workflow)
            _ = workflow.versions
            return workflow
        finally:
            if owns_session:
                db.close()

    def get_workflow(
        self, workflow_id: int, session: Session | None = None
    ) -> Workflow:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            _ = workflow.versions
            return workflow
        finally:
            if owns_session:
                db.close()

    def list_versions(
        self, workflow_id: int, session: Session | None = None
    ) -> list[WorkflowDefinition]:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            definitions = db.scalars(
                select(WorkflowDefinition)
                .where(WorkflowDefinition.workflow_id == workflow_id)
                .order_by(WorkflowDefinition.version.desc())
            ).all()
            for definition in definitions:
                _ = definition.steps
            return definitions
        finally:
            if owns_session:
                db.close()

    def get_version(
        self, workflow_id: int, version_id: int, session: Session | None = None
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition).where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def create_workflow(
        self,
        *,
        slug: str,
        display_name: str,
        description: str | None = None,
        graph_payload: dict[str, Any] | None = None,
        owner_id: int | None = None,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            # S'assure que le workflow ChatKit par défaut existe avant de créer un
            # nouveau workflow utilisateur. Cela évite que le premier workflow
            # créé soit rétroactivement utilisé comme valeur par défaut,
            # ce qui perturberait la validation des références imbriquées.
            self._ensure_default_workflow(db)

            existing = db.scalar(select(Workflow).where(Workflow.slug == slug))
            if existing is not None:
                raise WorkflowValidationError("Un workflow avec ce slug existe déjà.")
            workflow = Workflow(
                slug=slug, display_name=display_name, description=description, owner_id=owner_id
            )
            db.add(workflow)
            db.flush()

            nodes, edges = self._graph_validator.normalize_graph(
                graph_payload, allow_empty=True
            )

            # Always mark the initial version as active so the workflow can be selected
            # in the builder, even if it's empty. Users can edit it later.
            mark_active = True

            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name="Version initiale",
                mark_active=mark_active,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def import_workflow(
        self,
        *,
        graph_payload: Mapping[str, Any] | None,
        session: Session | None = None,
        workflow_id: int | None = None,
        slug: str | None = None,
        display_name: str | None = None,
        description: str | None = None,
        version_name: str | None = None,
        mark_as_active: bool = False,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            nodes, edges = self._graph_validator.normalize_graph(graph_payload)

            slug_value = slug.strip() if isinstance(slug, str) else None
            display_name_value = (
                display_name.strip() if isinstance(display_name, str) else None
            )
            description_value = (
                description.strip() or None
                if isinstance(description, str)
                else None
            )
            version_label = (
                version_name.strip() or None
                if isinstance(version_name, str)
                else None
            )

            workflow: Workflow | None = None
            if workflow_id is not None:
                workflow = db.get(Workflow, workflow_id)
                if workflow is None:
                    raise WorkflowNotFoundError(workflow_id)
            elif slug_value:
                workflow = db.scalar(
                    select(Workflow).where(Workflow.slug == slug_value)
                )

            if workflow is None:
                if not slug_value or not display_name_value:
                    raise WorkflowValidationError(
                        "Un slug et un nom sont requis pour importer un nouveau "
                        "workflow."
                    )
                existing = db.scalar(
                    select(Workflow.id).where(Workflow.slug == slug_value)
                )
                if existing is not None:
                    raise WorkflowValidationError(
                        "Un workflow avec ce slug existe déjà."
                    )
                workflow = Workflow(
                    slug=slug_value,
                    display_name=display_name_value,
                    description=description_value,
                )
                db.add(workflow)
                db.flush()
                name = version_label or "Version importée"
                definition = self._create_definition_from_graph(
                    workflow=workflow,
                    nodes=nodes,
                    edges=edges,
                    session=db,
                    name=name,
                    mark_active=True,
                )
                db.commit()
                db.refresh(definition)
                return self._fully_load_definition(definition)

            updates: dict[str, Any] = {}
            if slug_value is not None and slug_value != workflow.slug:
                updates["slug"] = slug_value
            if (
                display_name_value is not None
                and display_name_value != (workflow.display_name or "")
            ):
                updates["display_name"] = display_name_value
            if description is not None and description_value != workflow.description:
                updates["description"] = description_value

            if updates:
                workflow = self.update_workflow(workflow.id, updates, session=db)

            effective_mark_active = bool(mark_as_active)
            if not effective_mark_active and workflow.active_version_id is None:
                effective_mark_active = True

            name = version_label or "Version importée"
            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name=name,
                mark_active=effective_mark_active,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def update_workflow(
        self,
        workflow_id: int,
        updates: Mapping[str, Any],
        *,
        session: Session | None = None,
    ) -> Workflow:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)

            if not updates:
                return workflow

            if "display_name" in updates:
                display_name_raw = updates["display_name"]
                if display_name_raw is None:
                    raise WorkflowValidationError(
                        "Le nom du workflow ne peut pas être vide."
                    )
                display_name = str(display_name_raw).strip()
                if not display_name:
                    raise WorkflowValidationError(
                        "Le nom du workflow ne peut pas être vide."
                    )
                workflow.display_name = display_name

            if "slug" in updates:
                slug_raw = updates["slug"]
                if slug_raw is None:
                    raise WorkflowValidationError(
                        "Le slug du workflow ne peut pas être vide."
                    )
                slug = str(slug_raw).strip()
                if not slug:
                    raise WorkflowValidationError(
                        "Le slug du workflow ne peut pas être vide."
                    )
                defaults = self._workflow_defaults
                if (
                    workflow.slug == defaults.default_workflow_slug
                    and slug != defaults.default_workflow_slug
                ):
                    raise WorkflowValidationError(
                        "Le slug du workflow par défaut ne peut pas être modifié."
                    )
                if slug != workflow.slug:
                    existing = db.scalar(
                        select(Workflow.id).where(
                            Workflow.slug == slug, Workflow.id != workflow_id
                        )
                    )
                    if existing is not None:
                        raise WorkflowValidationError(
                            "Un workflow avec ce slug existe déjà."
                        )
                    workflow.slug = slug

            if "description" in updates:
                description_raw = updates["description"]
                if description_raw is None:
                    workflow.description = None
                else:
                    description = str(description_raw).strip()
                    workflow.description = description or None

            if "lti_enabled" in updates:
                lti_enabled = bool(updates["lti_enabled"])
                workflow.lti_enabled = lti_enabled

            if "lti_registration_ids" in updates:
                lti_registration_ids = updates["lti_registration_ids"]
                if lti_registration_ids is not None:
                    # Fetch the registrations
                    registrations = db.scalars(
                        select(LTIRegistration).where(
                            LTIRegistration.id.in_(lti_registration_ids)
                        )
                    ).all()
                    # Update the relationship
                    workflow.lti_registrations = list(registrations)

            if "lti_show_sidebar" in updates:
                workflow.lti_show_sidebar = bool(updates["lti_show_sidebar"])

            if "lti_show_header" in updates:
                workflow.lti_show_header = bool(updates["lti_show_header"])

            if "lti_enable_history" in updates:
                workflow.lti_enable_history = bool(updates["lti_enable_history"])

            workflow.updated_at = datetime.datetime.now(datetime.UTC)
            db.add(workflow)
            db.commit()
            db.refresh(workflow)
            return workflow
        finally:
            if owns_session:
                db.close()

    def delete_workflow(
        self, workflow_id: int, *, session: Session | None = None
    ) -> None:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)

            db.delete(workflow)
            db.commit()
        finally:
            if owns_session:
                db.close()

    def duplicate_workflow(
        self, workflow_id: int, new_name: str, *, session: Session | None = None
    ) -> Workflow:
        """Duplique un workflow existant avec un nouveau nom."""
        db, owns_session = self._get_session(session)
        try:
            # Récupère le workflow original
            original_workflow = db.get(Workflow, workflow_id)
            if original_workflow is None:
                raise WorkflowNotFoundError(workflow_id)

            # Vérifie qu'il a une version active
            if original_workflow.active_version_id is None:
                raise WorkflowValidationError(
                    "Impossible de dupliquer un workflow sans version active."
                )

            # Récupère la version active
            active_version = db.get(
                WorkflowDefinition, original_workflow.active_version_id
            )
            if active_version is None:
                raise WorkflowVersionNotFoundError(
                    workflow_id, original_workflow.active_version_id
                )

            # Extrait le graph de la version active
            graph_payload = serialize_definition_graph(active_version)

            # Génère un slug unique pour le nouveau workflow
            base_slug = original_workflow.slug
            new_slug = base_slug
            counter = 1
            while db.scalar(
                select(Workflow.id).where(Workflow.slug == new_slug)
            ) is not None:
                new_slug = f"{base_slug}-{counter}"
                counter += 1

            # Crée le nouveau workflow
            new_workflow = Workflow(
                slug=new_slug,
                display_name=new_name,
                description=original_workflow.description,
            )
            db.add(new_workflow)
            db.flush()

            # Parse et valide le graph
            nodes, edges = self._graph_validator.normalize_graph(graph_payload)

            # Crée la version initiale pour le nouveau workflow
            definition = self._create_definition_from_graph(
                workflow=new_workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name="Version initiale",
                mark_active=True,
            )

            db.commit()
            db.refresh(new_workflow)
            return new_workflow
        finally:
            if owns_session:
                db.close()

    def list_managed_hosted_workflows(
        self, session: Session | None = None
    ) -> list[HostedWorkflow]:
        """Retourne la liste des workflows hébergés gérés côté serveur."""

        db, owns_session = self._get_session(session)
        try:
            entries = db.scalars(
                select(HostedWorkflow).order_by(HostedWorkflow.created_at.asc())
            ).all()
            return entries
        finally:
            if owns_session:
                db.close()

    def list_hosted_workflow_configs(
        self, session: Session | None = None
    ) -> tuple[HostedWorkflowConfig, ...]:
        """Expose les workflows hébergés persistés sous forme de configuration."""

        entries = self.list_managed_hosted_workflows(session=session)
        return tuple(
            HostedWorkflowConfig(
                slug=entry.slug,
                workflow_id=entry.remote_workflow_id,
                label=entry.label,
                description=entry.description,
                managed=True,
            )
            for entry in entries
        )

    def create_hosted_workflow(
        self,
        *,
        slug: str,
        workflow_id: str,
        label: str | None = None,
        description: str | None = None,
        session: Session | None = None,
    ) -> HostedWorkflow:
        """Crée une nouvelle entrée de workflow hébergé gérée côté serveur."""

        db, owns_session = self._get_session(session)
        try:
            normalized_slug = _normalize_hosted_workflow_slug(slug)
            if not normalized_slug:
                raise WorkflowValidationError(
                    "Le slug du workflow hébergé est invalide."
                )

            normalized_workflow_id = _stringify_hosted_value(workflow_id)
            if not normalized_workflow_id:
                raise WorkflowValidationError(
                    "L'identifiant du workflow hébergé est obligatoire."
                )

            existing = db.scalar(
                select(HostedWorkflow).where(HostedWorkflow.slug == normalized_slug)
            )
            if existing is not None:
                raise WorkflowValidationError(
                    "Un workflow hébergé avec ce slug existe déjà."
                )

            current_definition = self.get_current(session=db)
            start_configs = resolve_start_hosted_workflows(current_definition)
            if any(config.slug == normalized_slug for config in start_configs):
                raise WorkflowValidationError(
                    "Ce slug est déjà utilisé par un workflow hébergé "
                    "dans le workflow par défaut."
                )

            normalized_label = _normalize_hosted_workflow_label(
                label, fallback=normalized_workflow_id
            )
            normalized_description = (
                description.strip() if isinstance(description, str) else None
            )

            entry = HostedWorkflow(
                slug=normalized_slug,
                remote_workflow_id=normalized_workflow_id,
                label=normalized_label,
                description=normalized_description or None,
            )
            db.add(entry)
            db.commit()
            db.refresh(entry)
            return entry
        finally:
            if owns_session:
                db.close()

    def delete_hosted_workflow(
        self, slug: str, *, session: Session | None = None
    ) -> None:
        """Supprime un workflow hébergé géré côté serveur."""

        db, owns_session = self._get_session(session)
        try:
            normalized_slug = _normalize_hosted_workflow_slug(slug)
            if not normalized_slug:
                raise WorkflowValidationError(
                    "Slug de workflow hébergé invalide."
                )

            entry = db.scalar(
                select(HostedWorkflow).where(HostedWorkflow.slug == normalized_slug)
            )
            if entry is None:
                raise HostedWorkflowNotFoundError(normalized_slug)

            db.delete(entry)
            db.commit()
        finally:
            if owns_session:
                db.close()

    def get_workflow_appearance(
        self,
        reference: int | str,
        *,
        session: Session | None = None,
    ) -> dict[str, Any]:
        db, owns_session = self._get_session(session)
        try:
            target = self._resolve_workflow_appearance_target(reference, db)
            override = self._get_workflow_appearance_entry(db, target)
            admin_settings = get_thread_title_prompt_override(db)
            effective = serialize_appearance_settings(admin_settings, override)
            return {
                "target_kind": target.kind,
                "workflow_id": target.workflow_id,
                "workflow_slug": target.slug,
                "label": target.label,
                "remote_workflow_id": target.remote_workflow_id
                if target.kind == "hosted"
                else None,
                "override": self._serialize_workflow_appearance_override(override),
                "effective": effective,
                "inherited_from_global": override is None,
            }
        finally:
            if owns_session:
                db.close()

    def update_workflow_appearance(
        self,
        reference: int | str,
        values: Mapping[str, Any],
        *,
        session: Session | None = None,
    ) -> dict[str, Any]:
        db, owns_session = self._get_session(session)
        try:
            target = self._resolve_workflow_appearance_target(reference, db)
            override = self._get_workflow_appearance_entry(db, target)

            inherit = bool(values.get("inherit_from_global"))
            update_kwargs = {
                key: values[key]
                for key in (
                    "color_scheme",
                    "radius_style",
                    "accent_color",
                    "use_custom_surface_colors",
                    "surface_hue",
                    "surface_tint",
                    "surface_shade",
                    "heading_font",
                    "body_font",
                    "start_screen_greeting",
                    "start_screen_prompt",
                    "start_screen_placeholder",
                    "start_screen_disclaimer",
                )
                if key in values
            }

            if inherit:
                if override is not None:
                    db.delete(override)
                    db.commit()
                return self.get_workflow_appearance(reference, session=db)

            if not update_kwargs and override is None:
                return self.get_workflow_appearance(reference, session=db)

            if override is None:
                override = WorkflowAppearance()
                db.add(override)

            if target.kind == "local":
                override.workflow_id = target.workflow_id
                override.hosted_workflow_slug = None
            else:
                override.workflow_id = None
                override.hosted_workflow_slug = target.slug

            if update_kwargs:
                changed = apply_appearance_update(override, **update_kwargs)
                if changed:
                    override.updated_at = datetime.datetime.now(datetime.UTC)

            if not self._has_appearance_override_values(override):
                db.delete(override)
                db.commit()
                return self.get_workflow_appearance(reference, session=db)

            db.commit()
            db.refresh(override)
            return self.get_workflow_appearance(reference, session=db)
        finally:
            if owns_session:
                db.close()

    def create_version(
        self,
        workflow_id: int,
        graph_payload: dict[str, Any],
        *,
        name: str | None = None,
        mark_as_active: bool = False,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            workflow = db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            nodes, edges = self._graph_validator.normalize_graph(graph_payload)
            definition = self._create_definition_from_graph(
                workflow=workflow,
                nodes=nodes,
                edges=edges,
                session=db,
                name=name,
                mark_active=mark_as_active,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def update_version(
        self,
        workflow_id: int,
        version_id: int,
        graph_payload: dict[str, Any],
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition)
                .where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
                .options(
                    selectinload(WorkflowDefinition.workflow),
                    selectinload(WorkflowDefinition.steps),
                    selectinload(WorkflowDefinition.transitions),
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            nodes, edges = self._graph_validator.normalize_graph(graph_payload)
            if definition.is_active:
                # Lorsqu'une version active est modifiée, on crée une nouvelle version
                # brouillon pour conserver l'historique de la version de production.
                draft = self._create_definition_from_graph(
                    workflow=definition.workflow,
                    nodes=nodes,
                    edges=edges,
                    session=db,
                    name=definition.name,
                    mark_active=False,
                )
                db.commit()
                db.refresh(draft)
                return self._fully_load_definition(draft)

            self._replace_definition_graph(
                definition,
                nodes=nodes,
                edges=edges,
                session=db,
            )
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def set_production_version(
        self,
        workflow_id: int,
        version_id: int,
        *,
        session: Session | None = None,
    ) -> WorkflowDefinition:
        db, owns_session = self._get_session(session)
        try:
            definition = db.scalar(
                select(WorkflowDefinition).where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.id == version_id,
                )
            )
            if definition is None:
                raise WorkflowVersionNotFoundError(workflow_id, version_id)
            workflow = definition.workflow or db.get(Workflow, workflow_id)
            if workflow is None:
                raise WorkflowNotFoundError(workflow_id)
            self._set_active_definition(workflow, definition, db)
            db.commit()
            db.refresh(definition)
            return self._fully_load_definition(definition)
        finally:
            if owns_session:
                db.close()

    def list_user_viewports(
        self, user_id: int, session: Session | None = None
    ) -> list[WorkflowViewport]:
        db, owns_session = self._get_session(session)
        try:
            logger.info("Listing viewports for user %s", user_id)
            viewports = db.scalars(
                select(WorkflowViewport)
                .where(WorkflowViewport.user_id == user_id)
                .order_by(
                    WorkflowViewport.updated_at.desc(),
                    WorkflowViewport.id.desc(),
                )
            ).all()
            logger.info("Loaded %s viewport(s) for user %s", len(viewports), user_id)
            return viewports
        finally:
            if owns_session:
                db.close()

    def replace_user_viewports(
        self,
        user_id: int,
        viewports: Iterable[Mapping[str, Any]],
        *,
        session: Session | None = None,
    ) -> list[WorkflowViewport]:
        db, owns_session = self._get_session(session)
        try:
            viewport_entries = list(viewports)
            logger.info(
                "Replacing workflow viewports for user %s (%s entries)",
                user_id,
                len(viewport_entries),
            )
            normalized: dict[
                tuple[int, int | None, str], tuple[float, float, float]
            ] = {}
            payload_device_types: set[str] = set()
            skipped_entries: list[dict[str, Any]] = []
            for entry in viewport_entries:
                workflow_raw = entry.get("workflow_id")
                if not isinstance(workflow_raw, int | float):
                    skipped_entries.append(
                        {
                            "reason": "invalid_workflow_id",
                            "entry": entry,
                        }
                    )
                    continue
                workflow_id = int(workflow_raw)
                if workflow_id <= 0:
                    skipped_entries.append(
                        {
                            "reason": "non_positive_workflow_id",
                            "entry": entry,
                        }
                    )
                    continue

                version_raw = entry.get("version_id")
                version_id: int | None
                if version_raw is None:
                    version_id = None
                elif isinstance(version_raw, int | float):
                    version_candidate = int(version_raw)
                    if version_candidate <= 0:
                        skipped_entries.append(
                            {
                                "reason": "non_positive_version_id",
                                "entry": entry,
                            }
                        )
                        continue
                    version_id = version_candidate
                else:
                    skipped_entries.append(
                        {
                            "reason": "invalid_version_id",
                            "entry": entry,
                        }
                    )
                    continue

                device_raw = entry.get("device_type", "desktop")
                if isinstance(device_raw, str):
                    device_type_candidate = device_raw.strip().lower()
                else:
                    device_type_candidate = ""

                if device_type_candidate not in {"desktop", "mobile"}:
                    skipped_entries.append(
                        {
                            "reason": "invalid_device_type",
                            "entry": entry,
                        }
                    )
                    continue

                x_raw = entry.get("x")
                y_raw = entry.get("y")
                zoom_raw = entry.get("zoom")
                if not isinstance(x_raw, int | float):
                    skipped_entries.append(
                        {
                            "reason": "invalid_x",
                            "entry": entry,
                        }
                    )
                    continue
                if not isinstance(y_raw, int | float):
                    skipped_entries.append(
                        {
                            "reason": "invalid_y",
                            "entry": entry,
                        }
                    )
                    continue
                if not isinstance(zoom_raw, int | float):
                    skipped_entries.append(
                        {
                            "reason": "invalid_zoom",
                            "entry": entry,
                        }
                    )
                    continue
                x = float(x_raw)
                y = float(y_raw)
                zoom = float(zoom_raw)
                if (
                    not math.isfinite(x)
                    or not math.isfinite(y)
                    or not math.isfinite(zoom)
                ):
                    skipped_entries.append(
                        {
                            "reason": "non_finite_coordinates",
                            "entry": entry,
                        }
                    )
                    continue

                normalized[
                    (workflow_id, version_id, device_type_candidate)
                ] = (x, y, zoom)
                payload_device_types.add(device_type_candidate)

            if skipped_entries:
                logger.info(
                    "Skipped %s viewport entrie(s) for user %s",
                    len(skipped_entries),
                    user_id,
                )

            logger.info(
                "Normalized %s viewport(s) for user %s",
                len(normalized),
                user_id,
            )

            existing = {
                (
                    viewport.workflow_id,
                    viewport.version_id,
                    viewport.device_type,
                ): viewport
                for viewport in db.scalars(
                    select(WorkflowViewport).where(
                        WorkflowViewport.user_id == user_id
                    )
                )
            }

            created_viewports: list[dict[str, Any]] = []
            updated_viewports: list[dict[str, Any]] = []
            for (
                workflow_id,
                version_id,
                device_type,
            ), (x, y, zoom) in normalized.items():
                viewport = existing.get((workflow_id, version_id, device_type))
                if viewport is None:
                    viewport = WorkflowViewport(
                        user_id=user_id,
                        workflow_id=workflow_id,
                        version_id=version_id,
                        device_type=device_type,
                        x=x,
                        y=y,
                        zoom=zoom,
                    )
                    db.add(viewport)
                    created_viewports.append(
                        {
                            "workflow_id": workflow_id,
                            "version_id": version_id,
                            "device_type": device_type,
                            "x": x,
                            "y": y,
                            "zoom": zoom,
                        }
                    )
                else:
                    viewport.x = x
                    viewport.y = y
                    viewport.zoom = zoom
                    updated_viewports.append(
                        {
                            "workflow_id": workflow_id,
                            "version_id": version_id,
                            "device_type": device_type,
                            "x": x,
                            "y": y,
                            "zoom": zoom,
                        }
                    )

            removed_keys: list[dict[str, Any]] = []
            target_device_types = (
                payload_device_types if payload_device_types else None
            )
            for key, viewport in existing.items():
                if (
                    target_device_types is not None
                    and viewport.device_type not in target_device_types
                ):
                    continue
                if key not in normalized:
                    db.delete(viewport)
                    removed_keys.append(
                        {
                            "workflow_id": viewport.workflow_id,
                            "version_id": viewport.version_id,
                            "device_type": viewport.device_type,
                        }
                    )

            db.commit()
            if created_viewports:
                logger.info(
                    "Created %s viewport(s) for user %s",
                    len(created_viewports),
                    user_id,
                )
            if updated_viewports:
                logger.info(
                    "Updated %s viewport(s) for user %s",
                    len(updated_viewports),
                    user_id,
                )
            if removed_keys:
                logger.info(
                    "Removed %s viewport(s) for user %s",
                    len(removed_keys),
                    user_id,
                )

            persisted = self.list_user_viewports(user_id, session=db)
            logger.info(
                "User %s now has %s persisted viewport(s)",
                user_id,
                len(persisted),
            )
            return persisted
        finally:
            if owns_session:
                db.close()

    def _needs_graph_backfill(self, definition: WorkflowDefinition) -> bool:
        has_start = any(step.kind == "start" for step in definition.steps)
        has_edges = bool(definition.transitions)
        if not (has_start and has_edges):
            return True

        existing_slugs = {step.slug for step in definition.steps}
        defaults = self._workflow_defaults
        if (
            defaults.expected_state_slugs
            and defaults.expected_state_slugs.issubset(existing_slugs)
        ):
            return False

        if (
            defaults.default_agent_slugs
            and defaults.default_agent_slugs.issubset(existing_slugs)
        ):
            return True

        if any(
            (step.agent_key or "").strip() in _LEGACY_AGENT_KEYS
            for step in definition.steps
        ):
            return True

        if _LEGACY_STATE_SLUGS.intersection(existing_slugs):
            return True

        return False

    def _backfill_legacy_definition(
        self, definition: WorkflowDefinition, session: Session
    ) -> WorkflowDefinition:
        legacy_agent_steps: dict[str, WorkflowStep] = {}
        for step in definition.steps:
            if step.agent_key:
                legacy_agent_steps.setdefault(step.agent_key, step)

        definition.transitions.clear()
        definition.steps.clear()
        session.flush()

        nodes, edges = self._graph_validator.normalize_graph(
            self._workflow_defaults.clone_workflow_graph()
        )
        slug_to_step: dict[str, WorkflowStep] = {}

        for index, node in enumerate(nodes, start=1):
            display_name = node.display_name
            is_enabled = node.is_enabled
            parameters = dict(node.parameters)
            metadata = dict(node.metadata)

            if node.kind in _AGENT_NODE_KINDS and node.agent_key:
                legacy_step = legacy_agent_steps.get(node.agent_key)
                if legacy_step is not None:
                    if legacy_step.display_name:
                        display_name = legacy_step.display_name
                    is_enabled = legacy_step.is_enabled
                    parameters = dict(legacy_step.parameters or {})
                    metadata = dict(legacy_step.ui_metadata or metadata)

            step = WorkflowStep(
                slug=node.slug,
                kind=node.kind,
                display_name=display_name,
                agent_key=node.agent_key,
                parent_slug=node.parent_slug,
                position=index,
                is_enabled=is_enabled,
                parameters=parameters,
                ui_metadata=metadata,
            )
            definition.steps.append(step)
            slug_to_step[node.slug] = step

        for edge in edges:
            definition.transitions.append(
                WorkflowTransition(
                    source_step=slug_to_step[edge.source_slug],
                    target_step=slug_to_step[edge.target_slug],
                    condition=edge.condition,
                    ui_metadata=dict(edge.metadata),
                )
            )

        definition.updated_at = datetime.datetime.now(datetime.UTC)
        session.add(definition)
        session.commit()
        session.refresh(definition)
        return self._fully_load_definition(definition)

class WorkflowPersistenceService(WorkflowService):
    """Alias explicite pour les opérations de persistance de workflows."""


def serialize_definition_graph(
    definition: WorkflowDefinition,
    *,
    include_position_metadata: bool = True,
) -> dict[str, Any]:
    """Construit la représentation graphe d'une définition de workflow."""

    nodes_payload = []
    for step in sorted(definition.steps, key=lambda s: s.position):
        metadata = dict(step.ui_metadata or {})
        if not include_position_metadata:
            metadata.pop("position", None)

        parameters = dict(step.parameters or {})
        if "workflow" in parameters:
            sanitized_reference = _sanitize_workflow_reference_for_serialization(
                parameters.get("workflow")
            )
            if sanitized_reference is None:
                parameters.pop("workflow", None)
            else:
                parameters["workflow"] = sanitized_reference

        nodes_payload.append(
            {
                "id": step.id,
                "slug": step.slug,
                "kind": step.kind,
                "display_name": step.display_name,
                "agent_key": step.agent_key,
                "parent_slug": step.parent_slug,
                "position": step.position,
                "is_enabled": step.is_enabled,
                "parameters": parameters,
                "metadata": metadata,
                "created_at": step.created_at,
                "updated_at": step.updated_at,
            }
        )

    edges_payload = []
    for edge in definition.transitions:
        metadata = dict(edge.ui_metadata or {})
        if not include_position_metadata:
            metadata.pop("position", None)

        edges_payload.append(
            {
                "id": edge.id,
                "source": edge.source_step.slug,
                "target": edge.target_step.slug,
                "condition": edge.condition,
                "metadata": metadata,
                "created_at": edge.created_at,
                "updated_at": edge.updated_at,
            }
        )

    return {"nodes": nodes_payload, "edges": edges_payload}


def serialize_definition(definition: WorkflowDefinition) -> dict[str, Any]:
    """Convertit un objet SQLAlchemy en dictionnaire API-friendly."""

    graph_payload = serialize_definition_graph(definition)

    agent_steps: list[dict[str, Any]] = []
    for step in sorted(definition.steps, key=lambda s: s.position):
        if step.kind not in _AGENT_NODE_KINDS:
            continue
        parameters = dict(step.parameters or {})
        if "workflow" in parameters:
            sanitized_reference = _sanitize_workflow_reference_for_serialization(
                parameters.get("workflow")
            )
            if sanitized_reference is None:
                parameters.pop("workflow", None)
            else:
                parameters["workflow"] = sanitized_reference

        agent_steps.append(
            {
                "id": step.id,
                "agent_key": step.agent_key,
                "position": step.position,
                "is_enabled": step.is_enabled,
                "parameters": parameters,
                "created_at": step.created_at,
                "updated_at": step.updated_at,
            }
        )

    return {
        "id": definition.id,
        "workflow_id": definition.workflow_id,
        "workflow_slug": definition.workflow.slug if definition.workflow else None,
        "workflow_display_name": (
            definition.workflow.display_name if definition.workflow else None
        ),
        "workflow_is_chatkit_default": bool(
            definition.workflow and definition.workflow.is_chatkit_default
        ),
        "name": definition.name,
        "version": definition.version,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
        "steps": agent_steps,
        "graph": graph_payload,
    }


def serialize_workflow_summary(workflow: Workflow) -> dict[str, Any]:
    active_version = workflow.active_version
    return {
        "id": workflow.id,
        "slug": workflow.slug,
        "display_name": workflow.display_name,
        "description": workflow.description,
        "created_at": workflow.created_at,
        "updated_at": workflow.updated_at,
        "active_version_id": workflow.active_version_id,
        "active_version_number": active_version.version if active_version else None,
        "is_chatkit_default": workflow.is_chatkit_default,
        "owner_id": workflow.owner_id,
        "owner_email": workflow.owner.email if workflow.owner else None,
        "shared_with": [
            {"id": user.id, "email": user.email}
            for user in workflow.shared_with
        ],
        "lti_enabled": workflow.lti_enabled,
        "lti_registration_ids": [reg.id for reg in workflow.lti_registrations],
        "lti_show_sidebar": workflow.lti_show_sidebar,
        "lti_show_header": workflow.lti_show_header,
        "lti_enable_history": workflow.lti_enable_history,
        "versions_count": len(workflow.versions),
    }


def serialize_version_summary(definition: WorkflowDefinition) -> dict[str, Any]:
    return {
        "id": definition.id,
        "workflow_id": definition.workflow_id,
        "name": definition.name,
        "version": definition.version,
        "is_active": definition.is_active,
        "created_at": definition.created_at,
        "updated_at": definition.updated_at,
    }


def serialize_viewport(viewport: WorkflowViewport) -> dict[str, Any]:
    return {
        "workflow_id": viewport.workflow_id,
        "version_id": viewport.version_id,
        "device_type": viewport.device_type,
        "x": viewport.x,
        "y": viewport.y,
        "zoom": viewport.zoom,
        "updated_at": viewport.updated_at,
    }
