"""Handler for transform nodes."""

from __future__ import annotations

import copy
import json
import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class TransformNodeHandler(BaseNodeHandler):
    """Handler for transform nodes.

    Transform nodes evaluate expressions and produce output without
    modifying workflow state (unlike assign/state nodes).
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute transform node."""
        from ..executor import WorkflowExecutionError, resolve_transform_value
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)

        # Get expressions from parameters
        expressions_payload = node.parameters.get("expressions")
        if expressions_payload is None:
            transform_source: Any = {}
        elif isinstance(expressions_payload, dict | list):
            transform_source = copy.deepcopy(expressions_payload)
        else:
            raise WorkflowExecutionError(
                node.slug,
                title or node.slug,
                ValueError(
                    "Le paramètre 'expressions' doit être un objet ou une liste."
                ),
                list(context.steps),
            )

        # Evaluate transform expressions
        try:
            transform_output = resolve_transform_value(
                transform_source,
                state=context.state,
                default_input_context=context.last_step_context,
                input_context=context.last_step_context,
            )
        except Exception as exc:
            raise WorkflowExecutionError(
                node.slug, title or node.slug, exc, list(context.steps)
            )

        # Record step
        if context.record_step:
            await context.record_step(node.slug, title, transform_output)

        # Format output text
        try:
            output_text = json.dumps(transform_output, ensure_ascii=False)
        except TypeError:
            output_text = str(transform_output)

        # Build last step context
        last_step_context = {
            "transform": transform_output,
            "output": transform_output,
            "output_parsed": transform_output,
            "output_structured": transform_output,
            "output_text": output_text,
        }

        # Find next transition
        transition = self._next_edge(context, node.slug)
        if transition is None:
            return NodeResult(
                next_slug=None, context_updates={"last_step_context": last_step_context}
            )

        return NodeResult(
            next_slug=transition.target_step.slug,
            context_updates={"last_step_context": last_step_context},
        )
