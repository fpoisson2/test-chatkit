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
