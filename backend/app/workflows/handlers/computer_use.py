"""Handler for computer_use nodes in manual mode."""

from __future__ import annotations

import logging
from datetime import datetime
from types import SimpleNamespace
from typing import TYPE_CHECKING, Any

from chatkit.types import (
    ComputerUseTask,
    Workflow,
    WorkflowItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
)

from .base import BaseNodeHandler
from .agent import AgentNodeHandler

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
        """Execute computer_use node.

        If mode is 'agent': Delegate to AgentNodeHandler to run as an agent.
        If mode is 'manual': Initialize environment and wait for user to finish.
        """
        # First, check the mode
        parameters = node.parameters or {}
        tools = parameters.get("tools", [])
        computer_use_config = None
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") == "computer_use":
                computer_use_config = tool.get("computer_use", tool)
                break

        mode = computer_use_config.get("mode", "manual") if computer_use_config else "manual"

        # Common initialization for both modes
        thread = context.runtime_vars.get("thread")
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        request_context = getattr(agent_context, "request_context", None) if agent_context else None
        user_id = getattr(request_context, "user_id", None) if request_context else None

        if mode == "agent":
            logger.info("Executing computer_use node %s in AGENT mode", node.slug)

            # Initialize computer tool and emit task for screencast visibility
            try:
                # Get agent instance to access its tools
                agent_instances = context.runtime_vars.get("agent_instances", {})
                agent = agent_instances.get(node.slug)

                computer_tool = None
                if agent:
                    # Find ComputerTool in agent tools
                    # Tools can be a list of tools or MCPServer instances
                    # We need to find the ComputerTool instance
                    from agents.tool import ComputerTool

                    # Agent tools might be coerced/normalized already
                    # Accessing agent.tools which is a list
                    if hasattr(agent, "tools"):
                        for tool in agent.tools:
                            if isinstance(tool, ComputerTool):
                                computer_tool = tool
                                break

                # If we found the tool, register session and emit task
                if computer_tool and computer_use_config:
                    is_ssh = computer_use_config.get("environment") == "ssh"
                    is_vnc = computer_use_config.get("environment") == "vnc"

                    debug_url_token = None
                    ssh_token = None
                    vnc_token = None

                    # Identifier for the current session to prevent duplicates
                    session_identifier = None

                    # Initialize environment if needed
                    if not is_ssh and not is_vnc and hasattr(computer_tool, "computer"):
                        try:
                            # Force browser initialization
                            await computer_tool.computer.screenshot()
                            debug_url = computer_tool.computer.debug_url

                            if debug_url:
                                session_identifier = f"browser_{debug_url}"

                                # Check if we already emitted a task for this session
                                last_session = context.state.get("active_computer_use_session")
                                if last_session != session_identifier:
                                    from ...routes.computer import register_debug_session
                                    debug_url_token = register_debug_session(debug_url, user_id)
                                    logger.info(f"Registered debug session for agent with token {debug_url_token[:8]}...")
                                else:
                                    logger.info(f"Skipping task emission for existing session: {session_identifier}")

                        except Exception as e:
                            logger.error(f"Failed to initialize browser for agent: {e}")

                    elif is_ssh and hasattr(computer_tool, "computer"):
                        try:
                            # Use ID of computer instance as identifier for SSH
                            session_identifier = f"ssh_{id(computer_tool.computer)}"

                            last_session = context.state.get("active_computer_use_session")
                            if last_session != session_identifier:
                                from ...routes.computer import register_ssh_session
                                ssh_token = register_ssh_session(
                                    ssh_instance=computer_tool.computer,
                                    ssh_config=computer_tool.computer.config,
                                    user_id=user_id,
                                )
                                logger.info(f"Registered SSH session for agent with token {ssh_token[:8]}...")
                            else:
                                logger.info(f"Skipping task emission for existing SSH session")

                        except Exception as e:
                            logger.error(f"Failed to register SSH session for agent: {e}")

                    elif is_vnc and hasattr(computer_tool, "computer"):
                        try:
                            # Use ID of computer instance as identifier for VNC
                            session_identifier = f"vnc_{id(computer_tool.computer)}"

                            last_session = context.state.get("active_computer_use_session")
                            if last_session != session_identifier:
                                from ...routes.computer import register_vnc_session
                                await computer_tool.computer.screenshot() # Force init
                                vnc_token = register_vnc_session(
                                    vnc_instance=computer_tool.computer,
                                    vnc_config=computer_tool.computer.config,
                                    user_id=user_id,
                                )
                                logger.info(f"Registered VNC session for agent with token {vnc_token[:8]}...")
                            else:
                                logger.info(f"Skipping task emission for existing VNC session")

                        except Exception as e:
                            logger.error(f"Failed to register VNC session for agent: {e}")

                    # Emit ComputerUseTask if we have a token
                    if (debug_url_token or ssh_token or vnc_token) and on_stream_event and agent_context:
                        task_kwargs: dict[str, Any] = {
                            "type": "computer_use",
                            "status_indicator": "loading",
                            "title": "Session VNC" if is_vnc else ("Session SSH" if is_ssh else "Environnement Computer Use"),
                            "mode": "agent",
                        }
                        if debug_url_token:
                            task_kwargs["debug_url_token"] = debug_url_token
                        if ssh_token:
                            task_kwargs["ssh_token"] = ssh_token
                        if vnc_token:
                            task_kwargs["vnc_token"] = vnc_token

                        computer_task = ComputerUseTask(**task_kwargs)

                        workflow = Workflow(
                            type="custom",
                            tasks=[computer_task],
                            expanded=True,
                        )

                        workflow_item = WorkflowItem(
                            id=agent_context.generate_id("workflow"),
                            thread_id=agent_context.thread.id,
                            created_at=datetime.now(),
                            workflow=workflow,
                        )

                        await on_stream_event(ThreadItemAddedEvent(item=workflow_item))
                        await on_stream_event(ThreadItemDoneEvent(item=workflow_item))
                        logger.info(f"Emitted ComputerUseTask for agent mode node {node.slug}")

                        # Update state with current session identifier
                        if session_identifier:
                            context.state["active_computer_use_session"] = session_identifier

            except Exception as e:
                logger.error(f"Error setting up computer use task for agent: {e}", exc_info=True)

            # Delegate to AgentNodeHandler
            # We don't pass an executor because v2 gets dependencies from context
            agent_handler = AgentNodeHandler()
            return await agent_handler._execute_agent(node, context)

        # Manual mode logic
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

        logger.info(
            ">>> ComputerUseHandler.execute: node=%s, pending_wait_state=%s, "
            "waiting_slug=%s, waiting_type=%s, resumed=%s",
            node.slug,
            pending_wait_state is not None,
            waiting_slug,
            waiting_type,
            resumed,
        )

        if resumed:
            # Resume from wait - user clicked "Terminer" or sent a message
            logger.info(f"Resuming from computer_use wait at node {node.slug}")

            # Close browser if still open (cleanup only, no screenshot emission)
            # Note: Screenshots are emitted by _handle_continue_workflow in server.py
            # We don't emit any items here to avoid duplicate screenshots.
            if thread:
                try:
                    # Get the computer_use config from saved state
                    parameters = node.parameters or {}
                    tools = parameters.get("tools", [])
                    computer_use_config = None
                    for tool in tools:
                        if isinstance(tool, dict) and tool.get("type") == "computer_use":
                            computer_use_config = tool.get("computer_use", tool)
                            break

                    if computer_use_config:
                        # Rebuild the tool to get the browser instance
                        computer_use_config = {**computer_use_config, "thread_id": thread.id}
                        from ...tool_factory import build_computer_use_tool
                        computer_tool = build_computer_use_tool({"computer_use": computer_use_config})

                        if computer_tool and hasattr(computer_tool, "computer"):
                            # Close the browser to stop the screencast
                            try:
                                await computer_tool.computer.close()
                                logger.info("Browser session closed")
                            except Exception as e:
                                logger.error(f"Failed to close browser: {e}")

                except Exception as e:
                    logger.error(f"Failed to close browser during resume: {e}")

            # Clear wait state
            if thread is not None:
                _set_wait_state_metadata(thread, None)

            # Get next slug from saved state
            next_slug = pending_wait_state.get("next_step_slug")
            if next_slug is None:
                next_slug = self._next_slug_or_fallback(node.slug, context)

            if not next_slug:
                start_slug = next(
                    (
                        step.slug
                        for step in context.nodes_by_slug.values()
                        if getattr(step, "kind", None) == "start"
                    ),
                    None,
                )

                if start_slug:
                    logger.info(
                        "No transition after computer_use; continuing workflow at start node %s",
                        start_slug,
                    )

                    # Continue directly to start node instead of waiting
                    # The user message that triggered this resume will be used for the next iteration
                    # This allows the workflow to loop: start -> computer_use -> start -> computer_use -> ...
                    return NodeResult(
                        next_slug=start_slug,
                        context_updates={"last_step_context": {"computer_use_completed": True}},
                    )

                # No start node found - finish workflow in waiting state
                context.runtime_vars["final_end_state"] = WorkflowEndState(
                    slug=node.slug,
                    status_type="waiting",
                    status_reason="En attente d'un nouveau message utilisateur.",
                    message="En attente d'un nouveau message utilisateur.",
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

        # Check if this is an SSH environment
        is_ssh = computer_use_config.get("environment") == "ssh"
        # Check if this is a VNC environment
        is_vnc = computer_use_config.get("environment") == "vnc"

        # Build the computer_use tool to initialize the environment
        computer_tool = build_computer_use_tool({"computer_use": computer_use_config})

        if computer_tool:
            # Get the debug_url from the HostedBrowser (not applicable for SSH/VNC)
            debug_url = None
            if not is_ssh and not is_vnc and hasattr(computer_tool, "computer"):
                try:
                    # Force browser initialization by taking a screenshot
                    await computer_tool.computer.screenshot()
                    debug_url = computer_tool.computer.debug_url
                    logger.info(f"Browser initialized with debug_url: {debug_url}")
                except Exception as e:
                    logger.error(f"Failed to initialize browser: {e}")

            # Register the debug session to get a token
            debug_url_token = None
            ssh_token = None
            vnc_token = None

            if debug_url:
                try:
                    from ...routes.computer import register_debug_session
                    debug_url_token = register_debug_session(debug_url, user_id)
                    logger.info(f"Registered debug session with token {debug_url_token[:8]}... for user {user_id}")
                except Exception as e:
                    logger.error(f"Failed to register debug session: {e}")
            elif is_ssh and hasattr(computer_tool, "computer"):
                # Register SSH session for interactive terminal
                try:
                    from ...routes.computer import register_ssh_session
                    ssh_token = register_ssh_session(
                        ssh_instance=computer_tool.computer,
                        ssh_config=computer_tool.computer.config,
                        user_id=user_id,
                    )
                    logger.info(f"Registered SSH session with token {ssh_token[:8]}... for user {user_id}")
                except Exception as e:
                    logger.error(f"Failed to register SSH session: {e}")
            elif is_vnc and hasattr(computer_tool, "computer"):
                # Register VNC session for remote desktop
                try:
                    from ...routes.computer import register_vnc_session
                    # Force VNC initialization by taking a screenshot (starts websockify)
                    await computer_tool.computer.screenshot()
                    vnc_token = register_vnc_session(
                        vnc_instance=computer_tool.computer,
                        vnc_config=computer_tool.computer.config,
                        user_id=user_id,
                    )
                    logger.info(f"Registered VNC session with token {vnc_token[:8]}... for user {user_id}")
                except Exception as e:
                    logger.error(f"Failed to register VNC session: {e}")

            if on_stream_event and agent_context and (debug_url_token or ssh_token or vnc_token):
                # Create ComputerUseTask
                task_kwargs: dict[str, Any] = {
                    "type": "computer_use",
                    "status_indicator": "loading",
                    "title": "Session VNC" if is_vnc else ("Session SSH" if is_ssh else "Environnement Computer Use"),
                }
                if debug_url_token:
                    task_kwargs["debug_url_token"] = debug_url_token
                if ssh_token:
                    task_kwargs["ssh_token"] = ssh_token
                if vnc_token:
                    task_kwargs["vnc_token"] = vnc_token

                # Add mode from config
                mode = computer_use_config.get("mode", "manual")
                if mode in ("agent", "manual"):
                    task_kwargs["mode"] = mode

                computer_task = ComputerUseTask(**task_kwargs)

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

                token_info = vnc_token or ssh_token or debug_url_token
                logger.info(f"Computer use environment initialized for node {node.slug} with token {token_info}")
            else:
                logger.warning(
                    f"Cannot emit computer_use task: "
                    f"on_stream_event={on_stream_event is not None}, "
                    f"agent_context={agent_context is not None}, "
                    f"debug_url={debug_url}, "
                    f"debug_url_token={debug_url_token}, "
                    f"ssh_token={ssh_token is not None}, "
                    f"vnc_token={vnc_token is not None}"
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
