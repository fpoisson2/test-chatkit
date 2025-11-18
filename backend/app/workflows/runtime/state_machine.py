"""State machine architecture for workflow execution.

This module provides a clean separation of concerns by extracting node handling
logic into individual handlers, replacing the monolithic run_workflow function.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any, Callable

from agents import TResponseInputItem

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep, WorkflowTransition
    from ..executor import WorkflowStepSummary


@dataclass
class ExecutionContext:
    """Shared context passed to all node handlers.

    This encapsulates all the state and dependencies needed during workflow execution,
    replacing the numerous closure variables in the original implementation.
    """

    # Core workflow state
    state: dict[str, Any]
    conversation_history: list[TResponseInputItem]
    last_step_context: dict[str, Any] | None
    steps: list[WorkflowStepSummary]

    # Workflow definition
    nodes_by_slug: dict[str, WorkflowStep]
    edges_by_source: dict[str, list[WorkflowTransition]]

    # Execution tracking
    current_slug: str
    guard_counter: int = 0
    max_iterations: int = 1000
    handler_calls: dict[str, int] | None = None

    # Final results
    final_output: dict[str, Any] | None = None
    final_node_slug: str | None = None
    is_finished: bool = False

    # Callbacks
    record_step: Callable[[str, str, dict[str, Any]], Any] | None = None

    # Additional dependencies (populated as needed)
    runtime_vars: dict[str, Any] = field(default_factory=dict)


@dataclass
class NodeResult:
    """Result of executing a node handler.

    Contains the next slug to transition to, plus any updates to context.
    """

    next_slug: str | None = None
    finished: bool = False
    context_updates: dict[str, Any] = field(default_factory=dict)
    output: dict[str, Any] | None = None


class NodeHandler(ABC):
    """Base class for all node type handlers.

    Each node type (start, end, condition, agent, etc.) gets its own handler
    implementing this interface.
    """

    @abstractmethod
    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute this node and return the next transition.

        Args:
            node: The workflow step to execute
            context: The current execution context

        Returns:
            NodeResult containing next slug and any context updates

        Raises:
            WorkflowExecutionError: If execution fails
        """
        ...

    def _node_title(self, node: WorkflowStep) -> str:
        """Get display title for a node."""
        return str(node.parameters.get("title", "")) if node.parameters else ""


class WorkflowStateMachine:
    """State machine that orchestrates workflow execution.

    This replaces the giant while loop in run_workflow with a clean,
    extensible architecture.
    """

    def __init__(self):
        self.handlers: dict[str, NodeHandler] = {}

    def register_handler(self, kind: str, handler: NodeHandler) -> None:
        """Register a handler for a specific node type."""
        self.handlers[kind] = handler

    async def execute(self, context: ExecutionContext) -> ExecutionContext:
        """Execute the workflow state machine.

        Args:
            context: Initial execution context

        Returns:
            Updated execution context after workflow completion
        """
        while not context.is_finished and context.guard_counter < context.max_iterations:
            context.guard_counter += 1

            # Get current node
            current_node = context.nodes_by_slug.get(context.current_slug)
            if current_node is None:
                from ..executor import WorkflowExecutionError
                raise WorkflowExecutionError(
                    "configuration",
                    "Configuration du workflow invalide",
                    RuntimeError(f"Nœud introuvable : {context.current_slug}"),
                    list(context.steps),
                )

            # Track final node
            context.final_node_slug = current_node.slug

            # Get handler for this node type
            handler = self.handlers.get(current_node.kind)
            if handler is None:
                from ..executor import WorkflowExecutionError
                raise WorkflowExecutionError(
                    "configuration",
                    f"Type de nœud non supporté : {current_node.kind}",
                    RuntimeError(f"Aucun handler pour le type {current_node.kind}"),
                    list(context.steps),
                )

            if context.handler_calls is not None:
                context.handler_calls[current_node.kind] = (
                    context.handler_calls.get(current_node.kind, 0) + 1
                )

            # Execute handler
            result = await handler.execute(current_node, context)

            # Apply context updates
            if result.context_updates:
                for key, value in result.context_updates.items():
                    setattr(context, key, value)

            # Handle result
            if result.finished:
                context.is_finished = True
                if result.output:
                    context.final_output = result.output
                break

            if result.next_slug:
                context.current_slug = result.next_slug
            else:
                # No next slug and not finished = end workflow in waiting state
                # This allows the workflow to wait for a new user message
                from ..executor import WorkflowEndState

                # Set end state to waiting if not already set
                if "final_end_state" not in context.runtime_vars:
                    context.runtime_vars["final_end_state"] = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="waiting",
                        status_reason="En attente d'un nouveau message utilisateur.",
                        message="En attente d'un nouveau message utilisateur.",
                    )

                context.is_finished = True
                break

        return context
