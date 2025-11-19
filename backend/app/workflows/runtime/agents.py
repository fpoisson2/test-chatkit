"""Utilities for preparing agent instances inside workflow execution."""

from __future__ import annotations

import json
import logging
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from agents import Agent
from agents.realtime.agent import RealtimeAgent

from ...chatkit.agent_registry import (
    AGENT_BUILDERS,
    AgentProviderBinding,
    _build_custom_agent,
    _create_response_format_from_pydantic,
    get_agent_provider_binding,
)
from ...chatkit_server.actions import (
    _ensure_widget_output_model,
    _parse_response_widget_config,
    _ResponseWidgetConfig,
)
# Model capabilities removed
from ...models import WorkflowDefinition, WorkflowStep, WorkflowTransition
from ..service import (
    WorkflowNotFoundError,
    WorkflowService,
    WorkflowValidationError,
    WorkflowVersionNotFoundError,
)

logger = logging.getLogger("chatkit.server")


def _build_voice_agent(overrides: dict[str, Any] | None = None) -> RealtimeAgent:
    """Build a RealtimeAgent for voice_agent nodes.

    RealtimeAgent is used for voice_agent nodes and supports voice-specific
    parameters like 'voice' and 'realtime' that regular Agent doesn't support.
    """
    merged = overrides or {}

    # Extract parameters for RealtimeAgent
    name = merged.get("name", "Voice Agent")
    instructions = merged.get("instructions")

    # Build kwargs for RealtimeAgent
    agent_kwargs: dict[str, Any] = {
        "name": name,
        "instructions": instructions,
    }

    # Add tools/mcp_servers if present
    if "tools" in merged:
        agent_kwargs["tools"] = merged["tools"]
    if "mcp_servers" in merged:
        agent_kwargs["mcp_servers"] = merged["mcp_servers"]

    # Note: voice and realtime parameters are configuration options
    # that are handled by the voice session runtime, not the agent constructor
    logger.debug(
        "Creating RealtimeAgent for voice_agent node: name=%s, has_tools=%s, has_mcp=%s",
        name,
        "tools" in merged,
        "mcp_servers" in merged,
    )

    agent = RealtimeAgent(**agent_kwargs)
    return agent


@dataclass(slots=True)
class AgentSetupResult:
    agent_instances: dict[str, Agent | RealtimeAgent]
    agent_provider_bindings: dict[str, AgentProviderBinding | None]
    nested_workflow_configs: dict[str, dict[str, Any]]
    widget_configs_by_step: dict[str, _ResponseWidgetConfig]
    load_nested_definition: Callable[[Mapping[str, Any]], WorkflowDefinition]


def prepare_agents(
    *,
    definition: WorkflowDefinition,
    service: WorkflowService,
    agent_steps_ordered: Sequence[WorkflowStep],
    nodes_by_slug: Mapping[str, WorkflowStep],
) -> AgentSetupResult:
    """Build agent instances and helper caches for workflow execution."""

    widget_configs_by_step: dict[str, _ResponseWidgetConfig] = {}

    def _register_widget_config(step: WorkflowStep) -> _ResponseWidgetConfig | None:
        widget_config = _parse_response_widget_config(step.parameters)
        if widget_config is None:
            return None
        widget_config = _ensure_widget_output_model(widget_config)
        widget_configs_by_step[step.slug] = widget_config
        return widget_config

    for step in nodes_by_slug.values():
        if step.kind == "widget":
            _register_widget_config(step)

    agent_instances: dict[str, Agent] = {}
    agent_provider_bindings: dict[str, AgentProviderBinding | None] = {}
    nested_workflow_configs: dict[str, dict[str, Any]] = {}
    nested_workflow_definition_cache: dict[
        tuple[str, str | int], WorkflowDefinition
    ] = {}

    def _load_nested_workflow_definition(
        reference: Mapping[str, Any]
    ) -> WorkflowDefinition:
        workflow_id_candidate = reference.get("id")
        slug_candidate = reference.get("slug")
        errors: list[str] = []

        if isinstance(workflow_id_candidate, int) and workflow_id_candidate > 0:
            cache_key = ("id", workflow_id_candidate)
            cached_definition = nested_workflow_definition_cache.get(cache_key)
            if cached_definition is not None:
                return cached_definition

            try:
                workflow = service.get_workflow(workflow_id_candidate)
            except WorkflowNotFoundError:
                errors.append(f"id={workflow_id_candidate}")
            else:
                version_id = getattr(workflow, "active_version_id", None)
                if version_id is None:
                    raise RuntimeError(
                        "Le workflow imbriqué "
                        f"{workflow_id_candidate} n'a pas de version active."
                    )
                try:
                    definition_obj = service.get_version(
                        workflow_id_candidate, version_id
                    )
                except WorkflowVersionNotFoundError as exc:
                    raise RuntimeError(
                        "Version active introuvable pour le workflow "
                        f"{workflow_id_candidate}."
                    ) from exc
                nested_workflow_definition_cache[cache_key] = definition_obj
                return definition_obj

        if isinstance(slug_candidate, str):
            normalized_slug = slug_candidate.strip()
            if normalized_slug:
                cache_key = ("slug", normalized_slug)
                cached_definition = nested_workflow_definition_cache.get(cache_key)
                if cached_definition is not None:
                    return cached_definition
                try:
                    definition_obj = service.get_definition_by_slug(normalized_slug)
                except WorkflowValidationError:
                    errors.append(f"slug={normalized_slug}")
                else:
                    nested_workflow_definition_cache[cache_key] = definition_obj
                    return definition_obj

        details = ", ".join(errors) if errors else "configuration inconnue"
        raise RuntimeError(f"Workflow imbriqué introuvable ({details}).")

    for step in agent_steps_ordered:
        logger.debug(
            "Paramètres bruts du step %s: %s",
            step.slug,
            (
                json.dumps(step.parameters, ensure_ascii=False)
                if step.parameters
                else "{}"
            ),
        )

        widget_config = _register_widget_config(step)

        workflow_reference = (step.parameters or {}).get("workflow")
        if step.kind == "agent" and isinstance(workflow_reference, Mapping):
            nested_workflow_configs[step.slug] = dict(workflow_reference)
            logger.info(
                "Étape %s configurée pour un workflow imbriqué : %s",
                step.slug,
                workflow_reference,
            )
            continue

        agent_key = (step.agent_key or "").strip()
        builder = AGENT_BUILDERS.get(agent_key)
        overrides_raw = step.parameters or {}
        overrides = dict(overrides_raw)

        raw_provider_id = overrides_raw.get("model_provider_id")
        provider_id = (
            raw_provider_id.strip() if isinstance(raw_provider_id, str) else None
        )
        raw_provider_slug = overrides_raw.get("model_provider_slug")
        if not isinstance(raw_provider_slug, str) or not raw_provider_slug.strip():
            fallback_slug = overrides_raw.get("model_provider")
            raw_provider_slug = (
                fallback_slug if isinstance(fallback_slug, str) else None
            )
        provider_slug = (
            raw_provider_slug.strip().lower()
            if isinstance(raw_provider_slug, str)
            else None
        )

        overrides.pop("model_provider_id", None)
        overrides.pop("model_provider_slug", None)
        overrides.pop("model_provider", None)

        logger.info(
            (
                "Construction de l'agent pour l'étape %s. widget_config: %s, "
                "output_model: %s"
            ),
            step.slug,
            widget_config is not None,
            widget_config.output_model if widget_config else None,
        )

        if widget_config is not None and widget_config.output_model is not None:
            overrides.pop("response_format", None)
            overrides.pop("response_widget", None)
            overrides.pop("widget", None)

            try:
                overrides["response_format"] = _create_response_format_from_pydantic(
                    widget_config.output_model
                )
                logger.info(
                    "response_format généré depuis le modèle widget pour l'étape %s",
                    step.slug,
                )
            except Exception as exc:
                logger.warning(
                    (
                        "Impossible de générer response_format depuis le "
                        "modèle widget : %s"
                    ),
                    exc,
                )

        # Create provider_binding BEFORE agent instantiation so it can be passed to the agent
        provider_binding = None
        if provider_id or provider_slug:
            provider_binding = get_agent_provider_binding(provider_id, provider_slug)
            if provider_binding is None:
                logger.warning(
                    "Impossible de résoudre le fournisseur %s (id=%s) pour l'étape %s",
                    provider_slug or "<inconnu>",
                    provider_id or "<aucun>",
                    step.slug,
                )
            else:
                # Add provider_binding to overrides so it's passed to the agent
                overrides["_provider_binding"] = provider_binding

        if builder is None:
            if agent_key:
                logger.warning(
                    (
                        "Aucun builder enregistré pour l'agent '%s', "
                        "utilisation de la configuration personnalisée."
                    ),
                    agent_key,
                )
            # voice_agent nodes should create RealtimeAgent instead of regular Agent
            if step.kind == "voice_agent":
                agent_instances[step.slug] = _build_voice_agent(overrides)
            else:
                agent_instances[step.slug] = _build_custom_agent(overrides)
        else:
            agent_instances[step.slug] = builder(overrides)

        agent_provider_bindings[step.slug] = provider_binding

    return AgentSetupResult(
        agent_instances=agent_instances,
        agent_provider_bindings=agent_provider_bindings,
        nested_workflow_configs=nested_workflow_configs,
        widget_configs_by_step=widget_configs_by_step,
        load_nested_definition=_load_nested_workflow_definition,
    )


def build_edges_by_source(
    transitions: Sequence[WorkflowTransition],
) -> dict[str, list[WorkflowTransition]]:
    """Pre-compute transitions grouped by source slug."""

    edges_by_source: dict[str, list[WorkflowTransition]] = {}
    for transition in transitions:
        edges_by_source.setdefault(transition.source_step.slug, []).append(transition)
    for edge_list in edges_by_source.values():
        edge_list.sort(key=lambda tr: tr.id or 0)
    return edges_by_source

