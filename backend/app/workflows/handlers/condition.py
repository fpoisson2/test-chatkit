"""Handler for condition nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


def _stringify_branch_value(value: Any) -> str | None:
    """Convert a value to its string representation for branch comparison."""
    if value is None:
        return None
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int | float):
        return str(value)
    if isinstance(value, str):
        trimmed = value.strip()
        return trimmed or None
    return None


class ConditionNodeHandler(BaseNodeHandler):
    """Handler for condition nodes.

    Evaluates a condition expression and routes to the appropriate branch.
    Supports multiple evaluation modes: truthy, falsy, equals, not_equals, value.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute condition node and determine next branch."""
        from ..runtime.state_machine import NodeResult
        from ..executor import WorkflowExecutionError
        from ...vector_store.ingestion import evaluate_state_expression

        # Evaluate condition
        branch = self._evaluate_condition(node, context, evaluate_state_expression)

        # DEBUG: Log input context before evaluation
        logger.info(
            "[DEBUG] Condition %s: last_step_context = %r",
            node.slug,
            context.last_step_context,
        )

        # DEBUG: Log condition result
        available_edges = context.edges_by_source.get(node.slug, [])
        logger.info("[DEBUG] Condition %s: returned branch='%s'", node.slug, branch)
        logger.info(
            "[DEBUG] Available edges from %s: %s",
            node.slug,
            [(e.target_step.slug, e.condition) for e in available_edges],
        )

        # Find matching transition
        transition = self._next_edge(context, node.slug, branch)
        logger.info(
            "[DEBUG] Condition %s → selected edge to: %s",
            node.slug,
            transition.target_step.slug if transition else "None",
        )

        if transition is None:
            branch_label = branch if branch is not None else "par défaut"
            raise WorkflowExecutionError(
                "configuration",
                "Configuration du workflow invalide",
                RuntimeError(
                    f"Transition manquante pour la branche {branch_label} du "
                    f"nœud {node.slug}"
                ),
                list(context.steps),
            )

        return NodeResult(next_slug=transition.target_step.slug)

    def _evaluate_condition(
        self,
        step: WorkflowStep,
        context: ExecutionContext,
        evaluate_state_expression: Any,
    ) -> str | None:
        """Evaluate condition and return branch name."""
        params = step.parameters or {}
        mode = str(params.get("mode", "truthy")).strip().lower()
        path = str(params.get("path", "")).strip()

        # Resolve value from state/context
        value = (
            evaluate_state_expression(
                path, state=context.state, default_input_context=context.last_step_context
            )
            if path
            else None
        )

        # DEBUG: Log condition evaluation
        logger.info(
            "[DEBUG] Condition %s: path='%s', mode='%s', resolved_value=%r",
            step.slug,
            path,
            mode,
            value,
        )

        if mode == "value":
            result = _stringify_branch_value(value)
            logger.info(
                "[DEBUG] Condition %s: mode=value, returning '%s'", step.slug, result
            )
            return result

        if mode in {"equals", "not_equals"}:
            expected = _stringify_branch_value(params.get("value"))
            candidate = _stringify_branch_value(value)
            if expected is None:
                result = "false" if mode == "equals" else "true"
                logger.info(
                    "[DEBUG] Condition %s: expected is None, returning '%s'",
                    step.slug,
                    result,
                )
                return result
            comparison = (candidate or "").lower() == expected.lower()
            if mode == "equals":
                result = "true" if comparison else "false"
                logger.info(
                    "[DEBUG] Condition %s: equals mode, candidate='%s', "
                    "expected='%s', returning '%s'",
                    step.slug,
                    candidate,
                    expected,
                    result,
                )
                return result
            result = "false" if comparison else "true"
            logger.info(
                "[DEBUG] Condition %s: not_equals mode, returning '%s'", step.slug, result
            )
            return result

        if mode == "falsy":
            result = "true" if not bool(value) else "false"
            logger.info(
                "[DEBUG] Condition %s: falsy mode, bool(value)=%s, returning '%s'",
                step.slug,
                bool(value),
                result,
            )
            return result

        result = "true" if bool(value) else "false"
        logger.info(
            "[DEBUG] Condition %s: truthy mode (default), bool(value)=%s, returning '%s'",
            step.slug,
            bool(value),
            result,
        )
        return result
