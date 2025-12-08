"""Handler for while loop nodes."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep, WorkflowTransition
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class WhileNodeHandler(BaseNodeHandler):
    """Handler for while loop nodes (kind='while').

    While loops evaluate a condition and execute nodes inside the loop
    until the condition becomes false or max iterations is reached.

    The detection of which nodes are "inside" the while is based on
    UI position metadata (spatial containment).
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute while loop logic."""
        from ..runtime.state_machine import NodeResult
        from ..executor import WorkflowExecutionError

        params = node.parameters or {}
        condition_expr = str(params.get("condition", "")).strip()
        max_iterations = int(params.get("max_iterations", 100))
        max_iterations = max(max_iterations - 1, 0)
        iteration_var = str(params.get("iteration_var", "")).strip()

        # Initialize loop state keys
        loop_counter_key = f"__while_{node.slug}_counter"
        loop_entry_key = f"__while_{node.slug}_entry"
        loop_input_id_key = f"__while_{node.slug}_input_id"

        logger.debug(
            "While %s: avant init, 'state' in state=%s, state.keys()=%s",
            node.slug,
            "state" in context.state,
            list(context.state.keys()),
        )

        # Ensure state["state"] exists
        if "state" not in context.state:
            logger.error(
                "While %s: clé 'state' absente de state - ERREUR INATTENDUE!",
                node.slug,
            )
            context.state["state"] = {}

        iteration_count = context.state["state"].get(loop_counter_key, 0)

        # Get current input ID to detect if there's a new user message
        current_input_item_id = context.runtime_vars.get("current_input_item_id")
        stored_input_id = context.state["state"].get(loop_input_id_key)

        # Check if we have a new user message
        if iteration_count == 0:
            new_input_reason = "first_iteration"
        elif stored_input_id is None:
            new_input_reason = "no_stored_input"
        elif current_input_item_id != stored_input_id:
            new_input_reason = "different_input_id"
        else:
            new_input_reason = "no_new_input"

        has_new_input = new_input_reason != "no_new_input"

        # If we've already iterated and there's no new input, exit to waiting state
        # unless the loop contains a wait_for_user_input node that will handle waiting.
        inside_nodes = self._get_nodes_inside_while(node, context)
        contains_wait_node = any(
            getattr(context.nodes_by_slug.get(slug), "kind", None) == "wait_for_user_input"
            for slug in inside_nodes
        )

        logger.info(
            "[WAIT_TRACE] While %s: iteration=%s, stored_input_id=%s, current_input_item_id=%s, has_new_input=%s, contains_wait_node=%s",
            node.slug,
            iteration_count,
            stored_input_id,
            current_input_item_id,
            has_new_input,
            contains_wait_node,
        )

        logger.info(
            "[WAIT_TRACE] While %s: new_input_reason=%s (stored=%s, current=%s)",
            node.slug,
            new_input_reason,
            stored_input_id,
            current_input_item_id,
        )

        if iteration_count > 0 and not has_new_input:
            from ..executor import WorkflowEndState

            # Clean up loop state
            context.state["state"].pop(loop_counter_key, None)
            context.state["state"].pop(loop_entry_key, None)
            context.state["state"].pop(loop_input_id_key, None)

            # Set waiting state
            context.runtime_vars["final_end_state"] = WorkflowEndState(
                slug=node.slug,
                status_type="waiting",
                status_reason="En attente d'un nouveau message utilisateur.",
                message="En attente d'un nouveau message utilisateur.",
            )

            logger.info(
                "[WAIT_TRACE] While %s: stopping without new input; waiting state recorded.",
                node.slug,
            )

            return NodeResult(finished=True)

        # Evaluate the while condition
        try:
            condition_result = self._evaluate_while_condition(
                condition_expr, context
            )
        except Exception as exc:
            raise WorkflowExecutionError(
                node.slug,
                self._node_title(node),
                exc,
                list(context.steps),
            )

        # Check if we should exit the loop
        if not condition_result:
            # Condition is false, exit the loop
            context.state["state"].pop(loop_counter_key, None)
            context.state["state"].pop(loop_entry_key, None)
            context.state["state"].pop(loop_input_id_key, None)
            transition = self._find_while_exit_transition(node, context)
        else:
            # Condition is true, continue loop
            iteration_count = iteration_count + 1

            # Check max iterations safety limit
            if iteration_count > max_iterations:
                context.state["state"].pop(loop_counter_key, None)
                context.state["state"].pop(loop_entry_key, None)
                context.state["state"].pop(loop_input_id_key, None)
                transition = self._find_while_exit_transition(node, context)
            else:
                # Save iteration counter
                context.state["state"][loop_counter_key] = iteration_count

                # Store current input ID for next iteration comparison
                if current_input_item_id is not None:
                    context.state["state"][loop_input_id_key] = current_input_item_id

                logger.debug(
                    "While %s: compteur incrémenté et sauvegardé, iteration_count=%d, state[loop_counter_key]=%s",
                    node.slug,
                    iteration_count,
                    context.state["state"].get(loop_counter_key),
                )

                # Update iteration variable if specified (1-based)
                if iteration_var:
                    context.state["state"][iteration_var] = iteration_count

                # Find the entry point to the while loop
                entry_slug = self._find_while_entry_point(node, context, loop_entry_key)

                if entry_slug is not None:
                    return NodeResult(next_slug=entry_slug)

                # No entry point found, try normal transitions
                transition = self._next_edge(context, node.slug, "loop")
                if transition is None:
                    transition = self._next_edge(context, node.slug)

        if transition is None:
            # No explicit transition found - use fallback logic
            # Reset loop counter before leaving
            context.state["state"].pop(loop_counter_key, None)
            context.state["state"].pop(loop_entry_key, None)
            context.state["state"].pop(loop_input_id_key, None)

            # Use standard fallback: while parent or start node
            next_slug = self._next_slug_or_fallback(node.slug, context)
            return NodeResult(next_slug=next_slug)

        return NodeResult(next_slug=transition.target_step.slug)

    def _evaluate_while_condition(
        self, condition_expr: str, context: ExecutionContext
    ) -> bool:
        """Evaluate while loop condition."""
        if not condition_expr:
            # No condition means always true (but limited by max_iterations)
            return True

        # Create a safe context for eval
        eval_context = {
            "state": context.state.get("state", {}),
            "globals": context.state.get("globals", {}),
        }
        return bool(eval(condition_expr, {"__builtins__": {}}, eval_context))

    def _find_while_exit_transition(
        self, while_node: WorkflowStep, context: ExecutionContext
    ) -> WorkflowTransition | None:
        """Find the transition that exits the while loop."""
        inside_nodes = self._get_nodes_inside_while(while_node, context)

        # Look for any transition from nodes inside to nodes outside
        for inside_slug in inside_nodes:
            for edge in context.edges_by_source.get(inside_slug, []):
                if edge.target_step.slug not in inside_nodes:
                    return edge

        # No exit found, look for any outgoing transition from while itself
        transition = self._next_edge(context, while_node.slug, "exit")
        if transition is None:
            transition = self._next_edge(context, while_node.slug)

        return transition

    def _find_while_entry_point(
        self,
        while_node: WorkflowStep,
        context: ExecutionContext,
        loop_entry_key: str,
    ) -> str | None:
        """Find the entry point (first node) inside the while loop."""
        entry_slug = context.state["state"].get(loop_entry_key)

        if entry_slug is not None:
            # Already have cached entry point
            return entry_slug

        # First time entering the loop, find the entry point
        inside_nodes = self._get_nodes_inside_while(while_node, context)

        # Look for a transition from outside into the while
        for node_slug in context.nodes_by_slug:
            node = context.nodes_by_slug[node_slug]
            if not self._belongs_to_current_workflow(node, context):
                continue
            if node_slug in inside_nodes or node_slug == while_node.slug:
                continue

            for edge in context.edges_by_source.get(node_slug, []):
                if edge.target_step.slug in inside_nodes:
                    entry_slug = edge.target_step.slug
                    context.state["state"][loop_entry_key] = entry_slug
                    return entry_slug

        # If still no entry point, take the first node by Y position
        if entry_slug is None and inside_nodes:
            sorted_nodes = sorted(
                [context.nodes_by_slug[slug] for slug in inside_nodes],
                key=lambda n: (n.ui_metadata or {}).get("position", {}).get("y", 0),
            )
            if sorted_nodes:
                entry_slug = sorted_nodes[0].slug
                context.state["state"][loop_entry_key] = entry_slug

        return entry_slug

    def _get_nodes_inside_while(
        self, while_node: WorkflowStep, context: ExecutionContext
    ) -> set[str]:
        """Detect which nodes are inside a while block.

        Uses explicit parent_slug relationships only. Nodes must have their
        parent_slug field set to the while node's slug to be considered inside.
        """
        if not self._belongs_to_current_workflow(while_node, context):
            logger.debug(
                "Bloc while %s ignoré car il appartient à un autre workflow (%s)",
                while_node.slug,
                getattr(while_node, "workflow_id", None),
            )
            return set()

        inside_nodes = set()

        # Use explicit parent_slug relationships
        for node in context.nodes_by_slug.values():
            if not self._belongs_to_current_workflow(node, context):
                continue

            if node.slug == while_node.slug:
                continue

            # Check if this node explicitly declares this while as its parent
            node_parent_slug = getattr(node, "parent_slug", None)
            if node_parent_slug == while_node.slug:
                inside_nodes.add(node.slug)

        if inside_nodes:
            logger.info(
                "While %s contient %d bloc(s): %s",
                while_node.slug,
                len(inside_nodes),
                ", ".join(inside_nodes),
            )
        else:
            logger.warning(
                "While %s ne contient aucun bloc. "
                "Re-sauvegardez le workflow pour générer parent_slug.",
                while_node.slug,
            )

        return inside_nodes

    def _belongs_to_current_workflow(
        self, step: WorkflowStep, context: ExecutionContext
    ) -> bool:
        """Check if a step belongs to the current workflow."""
        current_workflow_id = context.runtime_vars.get("current_workflow_id")
        if current_workflow_id is None:
            return True

        step_workflow_id = getattr(step, "workflow_id", None)
        if isinstance(step_workflow_id, int) and step_workflow_id != current_workflow_id:
            return False

        definition_id = context.runtime_vars.get("definition_id")
        step_definition_id = getattr(step, "definition_id", None)
        if (
            isinstance(step_definition_id, int)
            and isinstance(definition_id, int)
            and step_definition_id != definition_id
        ):
            return False

        return True
