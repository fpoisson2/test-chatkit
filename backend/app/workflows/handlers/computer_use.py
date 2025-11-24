"""Handler for computer_use nodes in manual mode."""

from __future__ import annotations

import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from chatkit.types import (
    ComputerUseTask,
    Workflow,
    WorkflowItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
)

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class ComputerUseNodeHandler(BaseNodeHandler):
    """Handler for computer_use nodes.

    Initializes a computer_use environment in manual mode without running an agent.
    The user can interact with the environment directly through the UI.
    """

    async def execute(
        self, node: WorkflowStep, context: ExecutionContext
    ) -> NodeResult:
        """Execute computer_use node - initialize environment and wait for user to finish."""
        from ..runtime.state_machine import NodeResult
        from ...tool_factory import build_computer_use_tool
        from ...chatkit_server.context import (
            _get_wait_state_metadata,
            _set_wait_state_metadata,
        )
        from ..executor import WorkflowEndState
        from ..utils import (
            _clone_conversation_history_snapshot,
            _json_safe_copy,
        )

        thread = context.runtime_vars.get("thread")
        agent_context = context.runtime_vars.get("agent_context")
        current_input_item_id = context.runtime_vars.get("current_input_item_id")

        # Check if we're resuming from computer_use wait
        pending_wait_state = (
            _get_wait_state_metadata(thread) if thread is not None else None
        )
        waiting_slug = (
            pending_wait_state.get("slug") if pending_wait_state else None
        )
        waiting_type = (
            pending_wait_state.get("wait_type") if pending_wait_state else None
        )
        resumed = (
            pending_wait_state is not None
            and waiting_slug == node.slug
            and waiting_type == "computer_use"
        )

        if resumed:
            # Resume from wait - user clicked "Terminer"
            logger.info(f"Resuming from computer_use wait at node {node.slug}")

            # Clear wait state
            if thread is not None:
                _set_wait_state_metadata(thread, None)

            # Get next slug from saved state
            next_slug = pending_wait_state.get("next_step_slug")
            if next_slug is None:
                next_slug = self._next_slug_or_fallback(node.slug, context)

            if not next_slug:
                # No transition after computer_use - finish workflow
                context.runtime_vars["final_end_state"] = WorkflowEndState(
                    slug=node.slug,
                    status_type="closed",
                    status_reason="Aucune transition disponible après le nœud computer_use.",
                    message="Session computer_use terminée.",
                )
                return NodeResult(
                    finished=True,
                    context_updates={
                        "last_step_context": {"computer_use_completed": True},
                        "final_node_slug": node.slug,
                    },
                )

            # Continue to next node
            return NodeResult(
                next_slug=next_slug,
                context_updates={"last_step_context": {"computer_use_completed": True}},
            )

        # First time - initialize computer_use environment and pause
        # Get computer_use config from node parameters
        parameters = node.parameters or {}
        tools = parameters.get("tools", [])

        # Find computer_use tool config
        computer_use_config = None
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") == "computer_use":
                computer_use_config = tool.get("computer_use", tool)
                break

        if not computer_use_config:
            # No computer_use config found, just continue
            logger.warning(f"Computer use node {node.slug} has no computer_use configuration")
            return NodeResult(next_slug=self._next_slug_or_fallback(node.slug, context))

        # Add thread_id to config for browser persistence
        if thread:
            computer_use_config = {**computer_use_config, "thread_id": thread.id}

        # Build the computer_use tool to initialize the environment
        computer_tool = build_computer_use_tool({"computer_use": computer_use_config})

        if computer_tool:
            # Get the debug_url from the HostedBrowser
            # We need to ensure the browser is started first by taking a screenshot
            debug_url = None
            if hasattr(computer_tool, "computer"):
                try:
                    # Force browser initialization by taking a screenshot
                    await computer_tool.computer.screenshot()
                    debug_url = computer_tool.computer.debug_url
                    logger.info(f"Browser initialized with debug_url: {debug_url}")
                except Exception as e:
                    logger.error(f"Failed to initialize browser: {e}")

            # Register the debug session to get a token
            debug_url_token = None
            if debug_url:
                try:
                    from ...routes.computer import register_debug_session
                    # Get user_id from agent_context
                    user_id = agent_context.user.id if agent_context and hasattr(agent_context, "user") else None
                    debug_url_token = register_debug_session(debug_url, user_id)
                except Exception as e:
                    logger.error(f"Failed to register debug session: {e}")

            # Create a workflow item with computer_use task
            on_stream_event = context.runtime_vars.get("on_stream_event")

            if on_stream_event and agent_context and debug_url_token:
                # Create ComputerUseTask
                computer_task = ComputerUseTask(
                    type="computer_use",
                    status_indicator="loading",
                    debug_url_token=debug_url_token,
                    title="Environnement Computer Use",
                )

                # Create Workflow
                workflow = Workflow(
                    type="custom",
                    tasks=[computer_task],
                    expanded=True,
                )

                # Create WorkflowItem
                workflow_item = WorkflowItem(
                    id=agent_context.generate_id("workflow"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    workflow=workflow,
                )

                # Emit the workflow item
                await on_stream_event(ThreadItemAddedEvent(item=workflow_item))

                # Mark as done immediately so it shows up
                await on_stream_event(ThreadItemDoneEvent(item=workflow_item))

                logger.info(f"Computer use environment initialized for node {node.slug} with token {debug_url_token}")
            else:
                logger.warning(
                    f"Cannot emit computer_use task: "
                    f"on_stream_event={on_stream_event is not None}, "
                    f"agent_context={agent_context is not None}, "
                    f"debug_url={debug_url}, "
                    f"debug_url_token={debug_url_token}"
                )
        else:
            logger.error(f"Failed to initialize computer_use tool for node {node.slug}")

        # Record the step
        title = self._node_title(node)
        if context.record_step:
            await context.record_step(
                node.slug,
                title,
                "Environnement Computer Use initialisé - En attente de l'utilisateur"
            )

        # Build and save wait state
        wait_state_payload: dict[str, Any] = {
            "slug": node.slug,
            "input_item_id": current_input_item_id,
            "wait_type": "computer_use",  # Identifier for this type of wait
        }

        conversation_snapshot = _clone_conversation_history_snapshot(
            context.conversation_history
        )
        if conversation_snapshot:
            wait_state_payload["conversation_history"] = conversation_snapshot

        # Store next slug with fallback logic
        next_slug_after_wait = self._next_slug_or_fallback(node.slug, context)
        if next_slug_after_wait is not None:
            wait_state_payload["next_step_slug"] = next_slug_after_wait

        if context.state:
            wait_state_payload["state"] = _json_safe_copy(context.state)

        # Add snapshot for workflow monitoring
        snapshot_payload: dict[str, Any] = {
            "current_slug": node.slug,
            "steps": [
                {"key": step.key, "title": step.title}
                for step in context.steps
            ],
        }
        wait_state_payload["snapshot"] = snapshot_payload

        if thread is not None:
            _set_wait_state_metadata(thread, wait_state_payload)

        # Set final end state to waiting
        wait_reason = "En attente que l'utilisateur termine la session Computer Use"
        context.runtime_vars["final_end_state"] = WorkflowEndState(
            slug=node.slug,
            status_type="waiting",
            status_reason=wait_reason,
            message=wait_reason,
        )

        # Return finished=True to pause execution
        return NodeResult(
            finished=True,
            context_updates={
                "last_step_context": {"computer_use_waiting": True},
                "final_node_slug": node.slug,
            },
        )
