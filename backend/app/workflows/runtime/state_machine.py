"""State machine architecture for workflow execution.

This module provides a clean separation of concerns by extracting node handling
logic into individual handlers, replacing the monolithic run_workflow function.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Any

from agents import TResponseInputItem

logger = logging.getLogger("chatkit.server")

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep, WorkflowTransition
    from ..executor import WorkflowStepSummary


async def _update_workflow_metadata(
    thread: Any,
    slug: str,
    title: str,
    steps_history: list[Any],
    agent_context: Any = None,
    context: Any = None,
) -> None:
    """Update workflow metadata in thread for monitoring purposes."""
    if thread is None:
        return

    # Get current metadata - handle both SDK threads (metadata attr) and DB threads (payload)
    metadata = getattr(thread, "metadata", None)

    # For SQLAlchemy ChatThread, metadata is in payload
    if not isinstance(metadata, dict):
        payload = getattr(thread, "payload", None)
        if isinstance(payload, dict):
            metadata = payload.get("metadata")

    if isinstance(metadata, dict):
        updated = dict(metadata)
    else:
        updated = {}

    # Ensure workflow metadata exists
    if "workflow" not in updated or not isinstance(updated["workflow"], dict):
        updated["workflow"] = {}

    # Update current step
    updated["workflow"]["current_step"] = {
        "slug": slug,
        "title": title,
    }

    # Update steps history
    updated["workflow"]["steps_history"] = [
        {"key": step.key, "title": step.title} for step in steps_history
    ]

    # AJOUT: Mettre à jour le summary du workflow affiché dans le chat via agent_context
    # Ne pas mettre à jour pour les widgets - ils ne doivent pas créer de bloc reasoning
    is_widget_step = slug.startswith("widget")
    if agent_context is not None and title and not is_widget_step:
        try:
            from chatkit.types import CustomSummary

            workflow_item = getattr(agent_context, "workflow_item", None)
            logger.info(f"[TITLE_TRACE] agent_context.workflow_item = {workflow_item}")

            # Si le workflow existe déjà, mettre à jour le summary
            if workflow_item is not None:
                workflow = getattr(workflow_item, "workflow", None)
                if workflow is not None:
                    workflow.summary = CustomSummary(title=title)
                    logger.info(
                        f"[TITLE_TRACE] Updated restored workflow summary with title: {title}"
                    )

                    # Stocker le workflow_item dans runtime_vars pour le partager entre étapes
                    if context is not None and hasattr(context, "runtime_vars"):
                        context.runtime_vars["workflow_item"] = workflow_item

                        # Aussi le stocker dans le thread pour plus de sécurité
                        thread = context.runtime_vars.get("thread")
                        if thread:
                            thread._workflow_item = workflow_item

                    # Forcer la mise à jour du frontend en remplaçant l'item dans le thread

                else:
                    logger.info(f"[TITLE_TRACE] workflow_item.workflow is None")
            else:
                # Essayer de restaurer le workflow_item depuis runtime_vars
                stored_workflow_item = None
                if context is not None and hasattr(context, "runtime_vars"):
                    stored_workflow_item = context.runtime_vars.get("workflow_item")

                if stored_workflow_item is not None:
                    logger.info(
                        f"[TITLE_TRACE] Restoring workflow_item from runtime_vars"
                    )
                    # Remettre le workflow_item dans agent_context
                    agent_context.workflow_item = stored_workflow_item
                    workflow = getattr(stored_workflow_item, "workflow", None)
                    if workflow is not None:
                        workflow.summary = CustomSummary(title=title)
                        logger.info(
                            f"[TITLE_TRACE] Updated restored workflow summary with title: {title}"
                        )

                    else:
                        logger.info(
                            f"[TITLE_TRACE] restored workflow_item.workflow is None"
                        )
                else:
                    logger.info(
                        f"[TITLE_TRACE] workflow_item is None and no stored workflow_item, skipping summary update"
                    )
        except Exception as exc:
            logger.warning(
                f"[TITLE_TRACE] Failed to update workflow summary: {exc}", exc_info=True
            )

    # Save back to thread - handle both SDK and DB threads
    # Try SDK thread first (has metadata attribute)
    if hasattr(thread, "metadata") and not hasattr(thread, "payload"):
        try:
            thread.metadata = updated
            return
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to update SDK thread metadata: %s", exc)

    # Handle SQLAlchemy ChatThread (has payload)
    payload = getattr(thread, "payload", None)
    if isinstance(payload, dict):
        try:
            payload["metadata"] = updated
            # Mark the object as modified for SQLAlchemy
            from sqlalchemy.orm.attributes import flag_modified

            flag_modified(thread, "payload")
        except Exception as exc:  # pragma: no cover
            logger.warning("Failed to update DB thread payload metadata: %s", exc)


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
    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
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
        # Priority: display_name > parameters["title"] > slug
        if node.display_name:
            return node.display_name
        if node.parameters and node.parameters.get("title"):
            return str(node.parameters.get("title"))
        return node.slug


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
        debug_enabled = bool(context.runtime_vars.get("debug"))

        if debug_enabled:
            logger.debug("Démarrage de l'exécution du workflow (mode debug activé)")

        while (
            not context.is_finished and context.guard_counter < context.max_iterations
        ):
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

            # Track steps count before handler execution
            steps_before = len(context.steps)

            # Mettre à jour le titre du workflow dès que l'étape commence
            node_title = ""
            if current_node.display_name:
                node_title = current_node.display_name
            elif current_node.parameters and current_node.parameters.get("title"):
                node_title = str(current_node.parameters.get("title"))
            elif hasattr(handler, "_node_title"):
                node_title = handler._node_title(current_node)
            else:
                node_title = current_node.slug

            logger.info(
                f"[TITLE_TRACE] Starting step {current_node.slug} with title: {node_title}"
            )
            await _update_workflow_metadata(
                context.runtime_vars.get("thread"),
                current_node.slug,
                node_title,
                context.steps,
                context.runtime_vars.get("agent_context"),
            )

            # Execute handler
            result = await handler.execute(current_node, context)

            # If handler didn't record the step, do it automatically
            # This ensures all steps (including start, condition, etc.) appear in history
            steps_after = len(context.steps)
            if steps_after == steps_before and context.record_step is not None:
                # Get step title
                logger.info(
                    f"[TITLE_TRACE] state_machine auto-recording step for slug={current_node.slug}, display_name={current_node.display_name}"
                )
                node_title = ""
                if current_node.display_name:
                    node_title = current_node.display_name
                    logger.info(
                        f"[TITLE_TRACE] state_machine using display_name: {node_title}"
                    )
                elif current_node.parameters and current_node.parameters.get("title"):
                    node_title = str(current_node.parameters.get("title"))
                    logger.info(
                        f"[TITLE_TRACE] state_machine using parameters title: {node_title}"
                    )
                elif hasattr(handler, "_node_title"):
                    node_title = handler._node_title(current_node)
                    logger.info(
                        f"[TITLE_TRACE] state_machine using handler._node_title: {node_title}"
                    )
                else:
                    node_title = current_node.slug
                    logger.info(
                        f"[TITLE_TRACE] state_machine using slug fallback: {node_title}"
                    )

                # Record the step with minimal payload
                await context.record_step(
                    current_node.slug,
                    node_title,
                    {"type": current_node.kind, "slug": current_node.slug},
                )

            # Update workflow metadata for monitoring (after each step execution)
            thread = context.runtime_vars.get("thread")
            if thread is not None:
                # Try multiple sources for the title
                node_title = ""
                # 1. Try display_name
                if current_node.display_name:
                    node_title = current_node.display_name
                # 2. Try parameters["title"]
                elif current_node.parameters and current_node.parameters.get("title"):
                    node_title = str(current_node.parameters.get("title"))
                # 3. Fallback to handler's _node_title method
                elif hasattr(handler, "_node_title"):
                    node_title = handler._node_title(current_node)

                logger.info(
                    f"[WORKFLOW_META] Updating metadata for step {current_node.slug}: "
                    f"title='{node_title}', steps_count={len(context.steps)}"
                )
                agent_context = context.runtime_vars.get("agent_context")
                await _update_workflow_metadata(
                    thread,
                    current_node.slug,
                    node_title,
                    context.steps,
                    agent_context,
                    context,
                )
            else:
                logger.warning(
                    f"[WORKFLOW_META] No thread in runtime_vars for step {current_node.slug}"
                )

            if debug_enabled:
                logger.debug(
                    "Résultat du handler %s: next_slug=%s finished=%s updates=%s",
                    current_node.kind,
                    result.next_slug,
                    result.finished,
                    list(result.context_updates.keys()),
                )

            # Apply context updates
            if result.context_updates:
                for key, value in result.context_updates.items():
                    setattr(context, key, value)
                    if debug_enabled:
                        logger.debug("Mise à jour du contexte: %s=%s", key, value)

            # Handle result
            if result.finished:
                context.is_finished = True
                if result.output:
                    context.final_output = result.output
                break

            if result.next_slug:
                if debug_enabled:
                    logger.debug(
                        "Transition vers le nœud suivant: %s -> %s",
                        current_node.slug,
                        result.next_slug,
                    )
                context.current_slug = result.next_slug
            else:
                # No next slug and not finished = end workflow in waiting state
                # This allows the workflow to wait for a new user message
                from ..executor import WorkflowEndState
                from ...chatkit_server.context import _set_wait_state_metadata

                # If no explicit final output, use the last step output when available
                if context.final_output is None:
                    last_context = context.last_step_context
                    if isinstance(last_context, dict) and "output" in last_context:
                        context.final_output = last_context["output"]

                # Set end state to waiting if not already set
                if "final_end_state" not in context.runtime_vars:
                    context.runtime_vars["final_end_state"] = WorkflowEndState(
                        slug=current_node.slug,
                        status_type="waiting",
                        status_reason="En attente d'un nouveau message utilisateur.",
                        message="En attente d'un nouveau message utilisateur.",
                    )

                # Clear any stale wait state metadata to avoid unintended resumes
                thread = context.runtime_vars.get("thread")
                if thread is not None:
                    _set_wait_state_metadata(thread, None)

                context.is_finished = True
                break

        return context
