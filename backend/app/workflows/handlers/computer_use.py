"""Handler for computer_use nodes in manual mode."""

from __future__ import annotations

import logging
from typing import TYPE_CHECKING, Any

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
        """Execute computer_use node - initialize environment and continue."""
        from ..runtime.state_machine import NodeResult
        from ...tool_factory import build_computer_use_tool

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
        thread = context.runtime_vars.get("thread")
        if thread:
            computer_use_config = {**computer_use_config, "thread_id": thread.id}

        # Build the computer_use tool to initialize the environment
        computer_tool = build_computer_use_tool({"computer_use": computer_use_config})

        if computer_tool:
            # Get the debug_url_token from the HostedBrowser
            debug_url_token = None
            if hasattr(computer_tool, "computer") and hasattr(computer_tool.computer, "debug_url_token"):
                debug_url_token = computer_tool.computer.debug_url_token

            # Create a task to display the computer_use environment
            on_stream_event = context.runtime_vars.get("on_stream_event")
            if on_stream_event and debug_url_token:
                from chatkit.types import WorkflowItemAddedEvent, WorkflowTask
                from datetime import datetime

                agent_context = context.runtime_vars.get("agent_context")
                if agent_context:
                    workflow_item = {
                        "id": agent_context.generate_id("workflow"),
                        "thread_id": agent_context.thread.id,
                        "created_at": datetime.now(),
                        "workflow": {
                            "tasks": [{
                                "type": "computer_use",
                                "debug_url_token": debug_url_token,
                                "status": "active",
                            }]
                        }
                    }

                    # Emit the workflow item with computer_use task
                    await on_stream_event(WorkflowItemAddedEvent(item=workflow_item))

            logger.info(f"Computer use environment initialized for node {node.slug}")
        else:
            logger.error(f"Failed to initialize computer_use tool for node {node.slug}")

        # Record the step
        title = self._node_title(node)
        if context.record_step:
            await context.record_step(
                node.slug,
                title,
                "Environnement Computer Use initialisé - Mode manuel"
            )

        # Continue to next node
        next_slug = self._next_slug_or_fallback(node.slug, context)

        return NodeResult(
            next_slug=next_slug,
            context_updates={
                "last_step_context": {"computer_use_initialized": True}
            },
        )
