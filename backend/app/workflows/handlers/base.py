"""Base handler implementation with common utilities."""

from __future__ import annotations

from typing import TYPE_CHECKING

from ..runtime.state_machine import NodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowTransition


class BaseNodeHandler(NodeHandler):
    """Base handler providing common utilities for all node types."""

    def _next_edge(
        self,
        context,
        source_slug: str,
        condition: str | None = None,
    ) -> WorkflowTransition | None:
        """Find the next transition from a given node.

        Args:
            context: Execution context
            source_slug: Source node slug
            condition: Optional condition to match (for conditional branches)

        Returns:
            Matching transition or None
        """
        edges = context.edges_by_source.get(source_slug, [])

        if not edges:
            return None

        # If condition specified, find matching edge
        if condition is not None:
            for edge in edges:
                edge_condition = getattr(edge, "condition", None)
                if edge_condition == condition:
                    return edge

        # Return first edge without condition (default path)
        for edge in edges:
            edge_condition = getattr(edge, "condition", None)
            if edge_condition is None or edge_condition == "":
                return edge

        # If no default found and no condition specified, return first edge
        if condition is None and edges:
            return edges[0]

        return None

    def _find_containing_while(
        self, node_slug: str, context
    ) -> str | None:
        """Find the while node that contains this node.

        Uses explicit parent_slug relationships to determine containment.

        Args:
            node_slug: The node to check
            context: Execution context

        Returns:
            The slug of the containing while node, or None if not in a while
        """
        node = context.nodes_by_slug.get(node_slug)
        if node is None:
            return None

        # Check if node has explicit parent_slug
        parent_slug = getattr(node, "parent_slug", None)
        if parent_slug:
            # Verify parent is a while node
            parent_node = context.nodes_by_slug.get(parent_slug)
            if parent_node and parent_node.kind == "while":
                return parent_slug

        return None

    def _node_title(self, step) -> str:
        """Get display title for a node."""
        return str(step.parameters.get("title", "")) if step.parameters else ""

    def _next_slug_or_fallback(self, node_slug: str, context) -> str | None:
        """Find next slug with fallback to while parent or None (waiting).

        This method implements the standard fallback logic:
        1. Try to find an explicit transition
        2. If no transition and inside a while loop, return to while
        3. If no transition and not in while, return None (workflow ends waiting)

        Args:
            node_slug: Current node slug
            context: Execution context

        Returns:
            Next node slug, or None to end workflow in waiting state
        """
        # Try to find explicit transition
        transition = self._next_edge(context, node_slug)
        if transition:
            return transition.target_step.slug

        # No explicit transition - check if inside a while loop
        containing_while = self._find_containing_while(node_slug, context)
        if containing_while:
            return containing_while

        # Not in a while - return None to end workflow in waiting state
        # This prevents infinite loops and allows the user to send a new message
        return None
