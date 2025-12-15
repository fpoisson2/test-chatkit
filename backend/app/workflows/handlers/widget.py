"""Handler for widget nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class WidgetNodeHandler(BaseNodeHandler):
    """Handler for widget nodes.

    Renders and displays widgets in the workflow.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute widget node."""
        from ...chatkit_server.actions import _should_wait_for_widget_action
        from ..runtime.state_machine import NodeResult
        from ..runtime.widget_streaming import _stream_response_widget

        title = self._node_title(node)
        agent_context = context.runtime_vars.get("agent_context")
        emit_stream_event = context.runtime_vars.get("emit_stream_event")
        on_widget_step = context.runtime_vars.get("on_widget_step")
        widget_configs_by_step = context.runtime_vars.get("widget_configs_by_step", {})

        # Get branch prefix for slug
        active_branch_id = context.runtime_vars.get("active_branch_id")
        branch_prefixed_slug = (
            f"{active_branch_id}:{node.slug}" if active_branch_id else node.slug
        )

        # Get widget config
        widget_config = widget_configs_by_step.get(node.slug)

        if widget_config is None:
            logger.warning(
                "Widget non configuré pour le nœud %s : aucune diffusion réalisée",
                node.slug,
            )
            last_step_context = {}
        else:
            # Stream widget
            rendered_widget = await _stream_response_widget(
                widget_config,
                step_slug=branch_prefixed_slug,
                step_title=title,
                step_context=context.last_step_context,
                state=context.state,
                last_step_context=context.last_step_context,
                agent_context=agent_context,
                emit_stream_event=emit_stream_event,
            )

            # Wait for widget action if needed
            action_payload: dict[str, Any] | None = None
            if on_widget_step is not None and _should_wait_for_widget_action(
                node.kind, widget_config
            ):
                # Emit awaiting_action event to signal the frontend that we're waiting for user input
                if emit_stream_event is not None:
                    from chatkit.types import AwaitingActionEvent
                    await emit_stream_event(AwaitingActionEvent(reason="widget"))

                result = await on_widget_step(node, widget_config)
                if result is not None:
                    action_payload = dict(result)

            # Build widget identifier
            widget_identifier = (
                widget_config.slug
                if widget_config.source == "library"
                else widget_config.definition_expression
            ) or node.slug

            # Build step payload
            step_payload: dict[str, Any] = {"widget": widget_identifier}
            if widget_config.source == "library" and widget_config.slug:
                step_payload["widget_slug"] = widget_config.slug
            elif (
                widget_config.source == "variable"
                and widget_config.definition_expression
            ):
                step_payload["widget_expression"] = (
                    widget_config.definition_expression
                )
            if widget_config.source == "variable" and rendered_widget is not None:
                step_payload["widget_definition"] = rendered_widget
            if action_payload is not None:
                step_payload["action"] = action_payload

            # Record step
            if context.record_step:
                await context.record_step(node.slug, title, step_payload)

            # Build context
            context_payload: dict[str, Any] = {"widget": widget_identifier}
            if widget_config.source == "library" and widget_config.slug:
                context_payload["widget_slug"] = widget_config.slug
            elif (
                widget_config.source == "variable"
                and widget_config.definition_expression
            ):
                context_payload["widget_expression"] = (
                    widget_config.definition_expression
                )
            if rendered_widget is not None:
                context_payload["widget_definition"] = rendered_widget
            if action_payload is not None:
                context_payload["action"] = action_payload

            last_step_context = context_payload

        # Find next transition with fallback
        next_slug = self._next_slug_or_fallback(node.slug, context)

        # Debug logging (preserved from original)
        logger.info(
            "[DEBUG] Widget %s → next slug: %s",
            node.slug,
            next_slug if next_slug else "None",
        )
        available_edges = context.edges_by_source.get(node.slug, [])
        logger.info(
            "[DEBUG] Available edges from %s: %s",
            node.slug,
            [(e.target_step.slug, e.condition) for e in available_edges],
        )

        return NodeResult(
            next_slug=next_slug,
            context_updates={"last_step_context": last_step_context},
        )
