"""Handler for state assignment nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class AssignNodeHandler(BaseNodeHandler):
    """Handler for state assignment nodes (kind='state').

    These nodes update workflow state by evaluating expressions and
    assigning values to state variables.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute state assignment operations."""
        from ..runtime.state_machine import NodeResult
        from ..executor import WorkflowExecutionError

        try:
            self._apply_state_node(node, context)
        except Exception as exc:
            raise WorkflowExecutionError(
                node.slug,
                self._node_title(node),
                exc,
                list(context.steps),
            )

        # Find next transition with fallback
        next_slug = self._next_slug_or_fallback(node.slug, context)
        return NodeResult(next_slug=next_slug)

    def _apply_state_node(self, step: WorkflowStep, context: ExecutionContext) -> None:
        """Apply all state operations defined in the node."""
        from ...vector_store.ingestion import evaluate_state_expression

        params = step.parameters or {}
        operations = params.get("state")
        if operations is None:
            return

        if not isinstance(operations, list):
            raise ValueError("Le paramètre 'state' doit être une liste d'opérations.")

        for entry in operations:
            if not isinstance(entry, dict):
                raise ValueError(
                    "Chaque opération de mise à jour d'état doit être un objet."
                )

            target_raw = entry.get("target")
            target = str(target_raw).strip() if target_raw is not None else ""
            if not target:
                raise ValueError("Chaque opération doit préciser une cible 'target'.")

            value = evaluate_state_expression(
                entry.get("expression"),
                state=context.state,
                default_input_context=context.last_step_context,
            )

            logger.debug(
                "set_state: stockage de %s = %s (type: %s)",
                target,
                str(value)[:200] if value else "None",
                type(value).__name__,
            )

            self._assign_state_value(context, target, value)

    def _assign_state_value(
        self, context: ExecutionContext, target_path: str, value: Any
    ) -> None:
        """Assign a value to a state path like 'state.foo.bar'."""
        path_parts = [part for part in target_path.split(".") if part]
        if not path_parts:
            raise ValueError("Chemin de mise à jour d'état manquant.")

        if path_parts[0] != "state":
            raise ValueError("Les mises à jour doivent commencer par 'state.'")

        cursor: Any = context.state
        for index, part in enumerate(path_parts):
            is_last = index == len(path_parts) - 1

            if is_last:
                cursor[part] = value
                break

            next_value = cursor.get(part)
            if next_value is None:
                next_value = {}
                cursor[part] = next_value
            elif not isinstance(next_value, dict):
                raise ValueError(
                    f"Impossible d'écrire dans state.{part} : valeur existante "
                    "incompatible."
                )
            cursor = next_value
