"""Handler for outbound_call nodes."""

from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import TYPE_CHECKING, Any

from .base import BaseNodeHandler

if TYPE_CHECKING:  # pragma: no cover
    from ...models import WorkflowStep
    from ..runtime.state_machine import ExecutionContext, NodeResult


logger = logging.getLogger("chatkit.server")


class OutboundCallNodeHandler(BaseNodeHandler):
    """Handler for outbound_call nodes.

    Initiates outbound phone calls using configured SIP accounts and voice workflows.
    Supports both fire-and-forget and wait-for-completion modes.
    """

    async def execute(self, node: WorkflowStep, context: ExecutionContext) -> NodeResult:
        """Execute outbound_call node.

        Args:
            node: The outbound_call workflow step
            context: Execution context with runtime vars and state

        Returns:
            NodeResult with next slug and call context
        """
        from chatkit.types import CustomTask, TaskItem, ThreadItemAddedEvent, ThreadItemDoneEvent

        from ...database import SessionLocal
        from ...models import SipAccount, Workflow, WorkflowDefinition
        from ...telephony.outbound_call_manager import get_outbound_call_manager
        from ..executor import WorkflowExecutionError
        from ..runtime.state_machine import NodeResult

        title = self._node_title(node)
        params = node.parameters or {}

        # Extract parameters
        to_number_raw = params.get("to_number", "")
        # TODO: Implement template resolution for {{state.phone_number}}
        to_number = to_number_raw

        voice_workflow_id = params.get("voice_workflow_id")
        sip_account_id = params.get("sip_account_id")
        wait_for_completion = params.get("wait_for_completion", True)

        # Get runtime dependencies
        agent_context = context.runtime_vars.get("agent_context")
        on_stream_event = context.runtime_vars.get("on_stream_event")
        workflow_definition = context.runtime_vars.get("workflow_definition")

        # Validation
        if not to_number or not isinstance(to_number, str):
            raise WorkflowExecutionError(
                "configuration",
                f"Numéro de téléphone invalide: {to_number}",
                step=node.slug,
                steps=list(context.steps),
            )

        if not voice_workflow_id:
            raise WorkflowExecutionError(
                "configuration",
                "voice_workflow_id est requis pour un appel sortant",
                step=node.slug,
                steps=list(context.steps),
            )

        # Create database session for this operation
        database_session = SessionLocal()

        try:
            # Resolve voice workflow definition ID
            voice_workflow_definition_id = await self._resolve_voice_workflow(
                database_session, voice_workflow_id, node.slug, title, context.steps
            )

            # Get or resolve SIP account
            sip_account_id = await self._resolve_sip_account(
                database_session, sip_account_id, node.slug, context.steps
            )

            # Get from_number from SIP account
            sip_account = database_session.query(SipAccount).filter_by(
                id=sip_account_id
            ).first()
            from_number = sip_account.contact_host if sip_account else "unknown"

            # Prepare metadata
            metadata = {
                "triggered_by_workflow_id": (
                    workflow_definition.id if workflow_definition else None
                ),
                "triggered_by_session_id": (
                    agent_context.thread.id if agent_context else None
                ),
                "trigger_node_slug": node.slug,
                "trigger_context": params.get("metadata", {}),
            }

            # Initiate the call
            outbound_manager = get_outbound_call_manager()
            call_session = await outbound_manager.initiate_call(
                db=database_session,
                to_number=to_number,
                from_number=from_number,
                workflow_id=voice_workflow_definition_id,
                sip_account_id=sip_account_id,
                metadata=metadata,
            )

            # Emit call started event
            await self._emit_call_started_event(
                on_stream_event,
                agent_context,
                node.slug,
                title,
                call_session.call_id,
                to_number,
                from_number,
            )

            # Record step
            if context.record_step:
                await context.record_step(
                    node.slug,
                    title,
                    f"Appel sortant vers {to_number}",
                )

            # Wait for completion if requested
            if wait_for_completion:
                last_step_context = await self._wait_for_call_completion(
                    outbound_manager,
                    database_session,
                    call_session,
                    to_number,
                    on_stream_event,
                    agent_context,
                    node.slug,
                    title,
                )
            else:
                # Fire-and-forget mode
                last_step_context = {
                    "outbound_call": {
                        "call_id": call_session.call_id,
                        "call_status": "initiated",
                        "to_number": to_number,
                    }
                }

        except Exception as exc:
            logger.error(
                "Erreur lors de l'appel sortant vers %s: %s",
                to_number,
                exc,
            )
            raise WorkflowExecutionError(
                node.slug,
                title,
                exc,
                list(context.steps),
            )
        finally:
            database_session.close()

        # Find next transition
        next_slug = self._next_slug_or_fallback(node.slug, context)

        return NodeResult(
            next_slug=next_slug,
            context_updates={"last_step_context": last_step_context},
        )

    async def _resolve_voice_workflow(
        self,
        db,
        voice_workflow_id: str,
        node_slug: str,
        title: str,
        steps: list,
    ) -> str:
        """Resolve voice workflow ID to workflow definition ID.

        Args:
            db: Database session
            voice_workflow_id: Workflow or WorkflowDefinition ID
            node_slug: Current node slug for error reporting
            title: Node title for error reporting
            steps: Execution steps for error reporting

        Returns:
            Workflow definition ID

        Raises:
            WorkflowExecutionError: If workflow not found or has no active version
        """
        from ...models import Workflow, WorkflowDefinition
        from ..executor import WorkflowExecutionError

        # Try as workflow.id first (most common case from frontend)
        workflow = db.query(Workflow).filter_by(id=voice_workflow_id).first()

        if workflow and workflow.active_version_id:
            return workflow.active_version_id
        elif workflow:
            # Workflow exists but no active version, search for one
            active_def = db.query(WorkflowDefinition).filter_by(
                workflow_id=workflow.id,
                is_active=True
            ).first()
            if not active_def:
                raise WorkflowExecutionError(
                    node_slug,
                    title,
                    Exception(
                        f"Le workflow '{workflow.display_name}' "
                        f"(ID: {voice_workflow_id}) n'a pas de version "
                        "active. Veuillez activer une version."
                    ),
                    list(steps),
                )
            return active_def.id
        else:
            # Maybe it's a workflow_definition.id directly
            voice_workflow_def = (
                db.query(WorkflowDefinition)
                .filter_by(id=voice_workflow_id)
                .first()
            )
            if not voice_workflow_def:
                raise WorkflowExecutionError(
                    node_slug,
                    title,
                    Exception(
                        "Le workflow avec l'ID "
                        f"{voice_workflow_id} n'existe pas. "
                        "Veuillez créer ou sélectionner un "
                        "workflow valide."
                    ),
                    list(steps),
                )
            return voice_workflow_def.id

    async def _resolve_sip_account(
        self,
        db,
        sip_account_id: str | None,
        node_slug: str,
        steps: list,
    ) -> str:
        """Resolve or find default SIP account.

        Args:
            db: Database session
            sip_account_id: Optional SIP account ID
            node_slug: Current node slug for error reporting
            steps: Execution steps for error reporting

        Returns:
            SIP account ID

        Raises:
            WorkflowExecutionError: If no SIP account found
        """
        from ...models import SipAccount
        from ..executor import WorkflowExecutionError

        if not sip_account_id:
            default_account = db.query(SipAccount).filter_by(
                is_default=True, is_active=True
            ).first()
            if default_account:
                sip_account_id = default_account.id

        if not sip_account_id:
            raise WorkflowExecutionError(
                "configuration",
                "Aucun compte SIP configuré pour les appels sortants",
                step=node_slug,
                steps=list(steps),
            )

        return sip_account_id

    async def _emit_call_started_event(
        self,
        on_stream_event,
        agent_context,
        node_slug: str,
        title: str,
        call_id: str,
        to_number: str,
        from_number: str,
    ) -> None:
        """Emit call started event to the user.

        Args:
            on_stream_event: Stream event callback
            agent_context: Agent execution context
            node_slug: Current node slug
            title: Node title
            call_id: Initiated call ID
            to_number: Destination number
            from_number: Source number
        """
        from chatkit.types import CustomTask, TaskItem, ThreadItemAddedEvent, ThreadItemDoneEvent

        if on_stream_event is None or agent_context is None or agent_context.thread is None:
            return

        try:
            outbound_call_event = {
                "type": "outbound_call.event",
                "step": {"slug": node_slug, "title": title},
                "event": {
                    "type": "call_started",
                    "call_id": call_id,
                    "to_number": to_number,
                    "from_number": from_number,
                },
            }

            task_item = TaskItem(
                id=agent_context.generate_id("task"),
                thread_id=agent_context.thread.id,
                created_at=datetime.now(),
                task=CustomTask(
                    title=f"📞 Appel en cours vers {to_number}...",
                    content=json.dumps(
                        outbound_call_event,
                        ensure_ascii=False,
                    ),
                ),
            )
            await on_stream_event(ThreadItemAddedEvent(item=task_item))
            await on_stream_event(ThreadItemDoneEvent(item=task_item))

            logger.info(
                "Événement d'appel sortant émis pour call_id=%s",
                call_id,
            )
        except Exception as e:
            logger.error(
                "Erreur lors de l'émission de l'événement d'appel sortant : %s",
                e,
            )

    async def _wait_for_call_completion(
        self,
        outbound_manager,
        db,
        call_session,
        to_number: str,
        on_stream_event,
        agent_context,
        node_slug: str,
        title: str,
    ) -> dict[str, Any]:
        """Wait for call completion and return call result.

        Args:
            outbound_manager: Outbound call manager instance
            db: Database session
            call_session: Call session object
            to_number: Destination number
            on_stream_event: Stream event callback
            agent_context: Agent execution context
            node_slug: Current node slug
            title: Node title

        Returns:
            Last step context with call results
        """
        from chatkit.types import CustomTask, TaskItem, ThreadItemAddedEvent, ThreadItemDoneEvent

        logger.info(
            "Attente de la fin de l'appel sortant %s",
            call_session.call_id,
        )
        await call_session.wait_until_complete()

        # Get call result
        call_result = await outbound_manager.get_call_status(
            db, call_session.call_id
        )

        if call_result:
            transcripts = call_result.get("transcripts", [])
            audio_recordings = call_result.get("audio_recordings", {})

            # Emit audio links if available
            if (
                audio_recordings
                and agent_context
                and agent_context.thread is not None
                and on_stream_event is not None
            ):
                await self._emit_call_ended_event(
                    on_stream_event,
                    agent_context,
                    node_slug,
                    title,
                    call_result,
                    audio_recordings,
                )

            return {
                "outbound_call": {
                    "call_id": call_result["call_id"],
                    "call_status": call_result["status"],
                    "answered": call_result["status"] == "completed",
                    "duration_seconds": call_result.get("duration_seconds"),
                    "to_number": to_number,
                    "transcripts": transcripts,
                    "audio_recordings": audio_recordings,
                }
            }
        else:
            return {
                "outbound_call": {
                    "call_id": call_session.call_id,
                    "call_status": "unknown",
                    "answered": False,
                    "to_number": to_number,
                }
            }

    async def _emit_call_ended_event(
        self,
        on_stream_event,
        agent_context,
        node_slug: str,
        title: str,
        call_result: dict,
        audio_recordings: dict,
    ) -> None:
        """Emit call ended event with audio links.

        Args:
            on_stream_event: Stream event callback
            agent_context: Agent execution context
            node_slug: Current node slug
            title: Node title
            call_result: Call result data
            audio_recordings: Audio recording URLs
        """
        from chatkit.types import CustomTask, TaskItem, ThreadItemAddedEvent, ThreadItemDoneEvent

        try:
            call_id = call_result["call_id"]
            audio_links = []

            if audio_recordings.get("inbound"):
                audio_links.append(
                    f"🎤 [Audio entrant](/api/outbound/call/{call_id}/audio/inbound)"
                )
            if audio_recordings.get("outbound"):
                audio_links.append(
                    f"🔊 [Audio sortant](/api/outbound/call/{call_id}/audio/outbound)"
                )
            if audio_recordings.get("mixed"):
                audio_links.append(
                    f"🎧 [Audio mixé](/api/outbound/call/{call_id}/audio/mixed)"
                )

            if audio_links:
                outbound_call_end_event = {
                    "type": "outbound_call.event",
                    "step": {
                        "slug": node_slug,
                        "title": title,
                    },
                    "event": {
                        "type": "call_ended",
                        "call_id": call_id,
                        "status": call_result.get("status"),
                        "duration_seconds": call_result.get("duration_seconds"),
                    },
                }

                audio_links_text = "\n".join(audio_links)
                task_item = TaskItem(
                    id=agent_context.generate_id("task"),
                    thread_id=agent_context.thread.id,
                    created_at=datetime.now(),
                    task=CustomTask(
                        title="**Enregistrements audio de l'appel :**",
                        content=(
                            json.dumps(
                                outbound_call_end_event,
                                ensure_ascii=False,
                            )
                            + "\n\n"
                            + audio_links_text
                        ),
                    ),
                )
                await on_stream_event(ThreadItemAddedEvent(item=task_item))
                await on_stream_event(ThreadItemDoneEvent(item=task_item))

                logger.info(
                    "Événement de fin d'appel émis pour call_id=%s",
                    call_id,
                )
        except Exception as e:
            logger.error(
                "Erreur lors de l'émission de l'événement de fin d'appel : %s",
                e,
            )
