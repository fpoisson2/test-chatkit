"""WebSocket relay between lightweight clients (Wear OS) and OpenAI Realtime API.

The client sends/receives raw audio over a simple WebSocket.  The backend
manages the full OpenAI Realtime session, handles tool calls server-side,
and streams audio back.

Protocol (client ↔ backend):
  Client sends:
    {"type": "start", "workflow_id": 30}          — start session
    {"type": "audio", "data": "<base64 PCM16>"}   — user audio chunk
    {"type": "stop"}                               — end session

  Backend sends:
    {"type": "ready"}                              — session established
    {"type": "audio", "data": "<base64 PCM16>"}   — agent audio chunk
    {"type": "status", "text": "..."}              — status message
    {"type": "error", "message": "..."}            — error
"""

from __future__ import annotations

import asyncio
import base64
import json
import logging
from typing import Any

import websockets
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from sqlalchemy import select

from ..database import SessionLocal
from ..models import User, Workflow, WorkflowDefinition, WorkflowStep
from ..security import decode_access_token

router = APIRouter()
logger = logging.getLogger(__name__)

OPENAI_REALTIME_WS = "wss://api.openai.com/v1/realtime"


def _build_session_config(
    workflow: Workflow,
    steps: list[WorkflowStep],
    tools: list[dict[str, Any]],
    voice: str = "ash",
    model: str = "gpt-realtime-1.5",
) -> dict[str, Any]:
    """Build the session.update payload for OpenAI Realtime."""
    from .workflows import _get_admin_voice_tools_definitions

    editable_kinds = {"message", "assistant_message", "agent"}
    step_descriptions: list[str] = []
    for s in steps:
        params = s.parameters or {}
        title = params.get("title", s.display_name or s.slug)
        if s.kind in editable_kinds:
            msg = params.get("message", "") or ""
            step_descriptions.append(
                f"- slug: {s.slug}, title: {title}, type: {s.kind}"
                + (f", content: {msg}" if msg else "")
            )
    steps_context = "\n".join(step_descriptions)

    instructions = (
        f"Tu es un assistant administrateur concis pour le workflow '{workflow.display_name}'. "
        "Sois extrêmement bref et direct. Donne uniquement l'information essentielle, "
        "pas de formules de politesse, pas de suggestions non sollicitées. "
        "Maximum une ou deux phrases courtes. "
        "RÈGLE CRITIQUE sur les appels d'outils : "
        "AVANT d'appeler un outil, dis une courte phrase comme 'OK, je m'en occupe, un instant...' ou 'Hmm, laisse-moi faire ça...'. "
        "Ne confirme JAMAIS que c'est fait avant d'avoir reçu le résultat de l'outil. "
        "APRÈS avoir reçu le résultat, confirme brièvement : 'C'est fait !' ou décris ce qui a été changé en une phrase. "
        "Quand l'utilisateur mentionne une étape par son contenu plutôt que son slug, "
        "utilise list_workflow_steps pour retrouver le bon slug à partir du contenu affiché. "
        "Réponds dans la même langue que l'utilisateur."
        f"\n\nÉtapes du workflow:\n{steps_context}"
    )

    return {
        "type": "session.update",
        "session": {
            "modalities": ["audio", "text"],
            "instructions": instructions,
            "voice": voice,
            "input_audio_format": "pcm16",
            "output_audio_format": "pcm16",
            "input_audio_transcription": {"model": "gpt-4o-mini-transcribe"},
            "tools": tools,
            "turn_detection": {
                "type": "server_vad",
            },
        },
    }


@router.websocket("/api/voice-relay/ws")
async def voice_relay_websocket(websocket: WebSocket):
    """WebSocket endpoint that relays audio between a lightweight client and OpenAI Realtime."""
    from ..admin_settings import get_settings
    from .workflows import _execute_admin_voice_tool, _get_admin_voice_tools_definitions

    # Auth via query param
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing token")
        return

    try:
        payload = decode_access_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid token")
        return

    if not payload.get("is_admin"):
        await websocket.close(code=4003, reason="Admin required")
        return

    await websocket.accept()
    logger.info("[VOICE_RELAY] Client connected")

    openai_ws = None

    try:
        # Wait for "start" message with workflow_id
        raw = await asyncio.wait_for(websocket.receive_json(), timeout=30)
        if raw.get("type") != "start":
            await websocket.send_json({"type": "error", "message": "Expected 'start' message"})
            return

        workflow_id = raw.get("workflow_id")
        if not workflow_id:
            await websocket.send_json({"type": "error", "message": "Missing workflow_id"})
            return

        # Load workflow context
        db = SessionLocal()
        try:
            workflow = db.get(Workflow, workflow_id)
            if not workflow:
                await websocket.send_json({"type": "error", "message": "Workflow not found"})
                return

            active_def = db.scalar(
                select(WorkflowDefinition).where(
                    WorkflowDefinition.workflow_id == workflow_id,
                    WorkflowDefinition.is_active == True,  # noqa: E712
                )
            )
            if not active_def:
                await websocket.send_json({"type": "error", "message": "No active definition"})
                return

            steps = db.scalars(
                select(WorkflowStep)
                .where(WorkflowStep.definition_id == active_def.id)
                .order_by(WorkflowStep.position)
            ).all()

            tools = _get_admin_voice_tools_definitions()
            session_config = _build_session_config(workflow, steps, tools)
        finally:
            db.close()

        # Connect to OpenAI Realtime WebSocket
        settings = get_settings()
        api_key = settings.openai_api_key or settings.model_api_key
        model = raw.get("model", "gpt-realtime-1.5")

        headers = {
            "Authorization": f"Bearer {api_key}",
            "OpenAI-Beta": "realtime=v1",
        }

        openai_ws = await websockets.connect(
            f"{OPENAI_REALTIME_WS}?model={model}",
            additional_headers=headers,
            max_size=None,
        )
        logger.info("[VOICE_RELAY] Connected to OpenAI Realtime")

        # Configure the session
        await openai_ws.send(json.dumps(session_config))
        await websocket.send_json({"type": "ready"})

        # Relay tasks
        async def client_to_openai():
            """Forward audio from watch client to OpenAI."""
            try:
                while True:
                    msg = await websocket.receive_json()
                    msg_type = msg.get("type")

                    if msg_type == "audio":
                        # Forward audio to OpenAI
                        await openai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": msg["data"],
                        }))
                    elif msg_type == "stop":
                        break
            except WebSocketDisconnect:
                pass
            except Exception as e:
                logger.error(f"[VOICE_RELAY] Client→OpenAI error: {e}")

        async def openai_to_client():
            """Forward audio from OpenAI to watch client, handle tool calls."""
            try:
                async for raw_msg in openai_ws:
                    event = json.loads(raw_msg)
                    event_type = event.get("type", "")

                    if event_type == "response.audio.delta":
                        # Forward audio chunk to client
                        delta = event.get("delta", "")
                        if delta:
                            await websocket.send_json({
                                "type": "audio",
                                "data": delta,
                            })

                    elif event_type == "response.function_call_arguments.done":
                        # Handle tool call server-side
                        call_id = event.get("call_id", "")
                        tool_name = event.get("name", "")
                        args_str = event.get("arguments", "{}")

                        logger.info(f"[VOICE_RELAY] Tool call: {tool_name}")
                        await websocket.send_json({
                            "type": "status",
                            "text": f"Exécution: {tool_name}...",
                        })

                        try:
                            args = json.loads(args_str)
                        except json.JSONDecodeError:
                            args = {}

                        # Execute tool with fresh DB session
                        tool_db = SessionLocal()
                        try:
                            result = await _execute_admin_voice_tool(
                                tool_name, args, workflow_id, tool_db,
                            )
                        except Exception as e:
                            result = f"Error: {e}"
                        finally:
                            tool_db.close()

                        logger.info(f"[VOICE_RELAY] Tool result: {result[:100]}")

                        # Send result back to OpenAI
                        await openai_ws.send(json.dumps({
                            "type": "conversation.item.create",
                            "item": {
                                "type": "function_call_output",
                                "call_id": call_id,
                                "output": result,
                            },
                        }))
                        await openai_ws.send(json.dumps({
                            "type": "response.create",
                        }))

                    elif event_type == "error":
                        err = event.get("error", {})
                        logger.error(f"[VOICE_RELAY] OpenAI error: {err}")
                        await websocket.send_json({
                            "type": "error",
                            "message": err.get("message", "Unknown error"),
                        })

            except websockets.exceptions.ConnectionClosed:
                logger.info("[VOICE_RELAY] OpenAI WS closed")
            except Exception as e:
                logger.error(f"[VOICE_RELAY] OpenAI→Client error: {e}")

        # Run both relay tasks concurrently
        done, pending = await asyncio.wait(
            [
                asyncio.create_task(client_to_openai()),
                asyncio.create_task(openai_to_client()),
            ],
            return_when=asyncio.FIRST_COMPLETED,
        )
        for task in pending:
            task.cancel()

    except WebSocketDisconnect:
        logger.info("[VOICE_RELAY] Client disconnected")
    except Exception as e:
        logger.error(f"[VOICE_RELAY] Error: {e}", exc_info=True)
    finally:
        if openai_ws:
            await openai_ws.close()
        logger.info("[VOICE_RELAY] Session ended")
