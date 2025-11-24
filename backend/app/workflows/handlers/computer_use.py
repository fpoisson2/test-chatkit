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
                    agent_context = context.runtime_vars.get("agent_context")
                    user_id = agent_context.user.id if agent_context and hasattr(agent_context, "user") else None
                    debug_url_token = register_debug_session(debug_url, user_id)
                except Exception as e:
                    logger.error(f"Failed to register debug session: {e}")

            # Create a workflow item with computer_use task
            on_stream_event = context.runtime_vars.get("on_stream_event")
            agent_context = context.runtime_vars.get("agent_context")

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
