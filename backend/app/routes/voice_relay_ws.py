"""WebSocket relay between lightweight clients (Wear OS) and OpenAI Realtime API.

The client sends/receives raw audio over a simple WebSocket.  The backend
manages the full OpenAI Realtime session, handles tool calls server-side,
and streams audio back.

Protocol (client ↔ backend):
  Client sends:
    {"type": "start", "workflow_id": 30}          — start session
    {"type": "audio", "data": "<base64 PCM16>"}   — user audio chunk
    {"type": "switch_workflow", "workflow_id": 42} — switch active workflow
    {"type": "stop"}                               — end session

  Backend sends:
    {"type": "ready"}                              — session established
    {"type": "ready", "workflow_name": "..."}      — session re-established after switch
    {"type": "audio", "data": "<base64 PCM16>"}   — agent audio chunk
    {"type": "status", "text": "..."}              — status message
    {"type": "workflows", "data": [...]}           — list of available workflows
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

from fastapi import Depends, HTTPException
from fastapi.responses import JSONResponse

from ..database import SessionLocal
from ..models import User, Workflow, WorkflowDefinition, WorkflowStep
from ..dependencies import get_current_user
from ..security import decode_access_token, decode_refresh_token

router = APIRouter()
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# REST endpoints for Wear OS
# ---------------------------------------------------------------------------


@router.get("/api/voice-relay/workflows")
async def list_workflows_for_voice(user: User = Depends(get_current_user)):
    """List workflows available for voice control (admin only)."""
    if not user.is_admin:
        raise HTTPException(status_code=403, detail="Admin required")
    db = SessionLocal()
    try:
        workflows = db.scalars(
            select(Workflow).order_by(Workflow.display_name)
        ).all()
        return [
            {"id": w.id, "name": w.display_name}
            for w in workflows
        ]
    finally:
        db.close()


@router.post("/api/voice-relay/auth")
async def voice_relay_auth_exchange(
    body: dict,
):
    """Exchange email/password for a JWT token (for Wear OS login).

    Body: {"email": "...", "password": "..."}
    Returns: {"token": "...", "refresh_token": "..."}
    """
    from ..security import create_access_token, create_refresh_token, verify_password

    email = body.get("email", "").strip()
    password = body.get("password", "")
    if not email or not password:
        raise HTTPException(status_code=400, detail="Email and password required")

    db = SessionLocal()
    try:
        user = db.scalar(select(User).where(User.email == email))
        if not user or not verify_password(password, user.password_hash):
            raise HTTPException(status_code=401, detail="Invalid credentials")
        if not user.is_admin:
            raise HTTPException(status_code=403, detail="Admin required")

        token = create_access_token(user)
        refresh = create_refresh_token(user)
        return {"token": token, "refresh_token": refresh}
    finally:
        db.close()


@router.post("/api/voice-relay/refresh")
async def voice_relay_refresh(body: dict):
    """Exchange a refresh token for new access + refresh tokens.

    Body: {"refresh_token": "..."}
    Returns: {"token": "...", "refresh_token": "..."}
    """
    from ..security import create_access_token, create_refresh_token

    refresh_tok = body.get("refresh_token", "")
    if not refresh_tok:
        raise HTTPException(status_code=400, detail="refresh_token required")

    payload = decode_refresh_token(refresh_tok)
    user_id = payload.get("sub")

    db = SessionLocal()
    try:
        user = db.get(User, int(user_id))
        if not user:
            raise HTTPException(status_code=401, detail="Utilisateur introuvable")
        if not user.is_admin:
            raise HTTPException(status_code=403, detail="Admin required")

        new_access = create_access_token(user)
        new_refresh = create_refresh_token(user)
        return {"token": new_access, "refresh_token": new_refresh}
    finally:
        db.close()


OPENAI_REALTIME_WS = "wss://api.openai.com/v1/realtime"


def _build_session_config(
    workflow: Workflow,
    steps: list[WorkflowStep],
    tools: list[dict[str, Any]],
    voice: str = "ash",
    model: str = "gpt-realtime-1.5",
) -> dict[str, Any]:
    """Build the session.update payload for OpenAI Realtime."""
    from .workflows import _get_admin_voice_tools_definitions, _get_config_fields, _get_editable_fields

    editable_kinds = {
        "message", "assistant_message", "agent",
        "evaluated_step", "help_loop", "guided_exercise",
    }
    step_descriptions: list[str] = []
    for s in steps:
        params = s.parameters or {}
        title = params.get("title", s.display_name or s.slug)
        if s.kind in editable_kinds:
            editable_fields = _get_editable_fields(s.kind)
            config_fields = _get_config_fields(s.kind)
            fields_info: list[str] = []
            for field_key in editable_fields:
                value = params.get(field_key, "") or ""
                if value:
                    preview = value[:80] + "…" if len(value) > 80 else value
                    fields_info.append(f"  {field_key}: {preview}")
            for field_key in config_fields:
                value = params.get(field_key)
                if value is not None and str(value).strip():
                    fields_info.append(f"  {field_key}: {value}")
            line = f"- slug: {s.slug}, title: {title}, type: {s.kind}"
            if fields_info:
                line += "\n" + "\n".join(fields_info)
            step_descriptions.append(line)
    steps_context = "\n".join(step_descriptions)

    # Add switch_workflow tool
    switch_tool = {
        "type": "function",
        "name": "switch_workflow",
        "description": (
            "Switch to a different workflow. Use this when the user asks to "
            "change or switch to another workflow. Returns the list of available "
            "workflows if no workflow_id is provided."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "workflow_id": {
                    "type": "integer",
                    "description": "The ID of the workflow to switch to. Omit to list available workflows.",
                },
            },
            "required": [],
        },
    }
    tools = list(tools) + [switch_tool]

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
                "type": "semantic_vad",
                "eagerness": "medium",
                "create_response": True,
                "interrupt_response": True,
            },
            "input_audio_noise_reduction": {
                "type": "near_field",
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

    async def _load_workflow_context(wf_id: int):
        """Load workflow, steps, tools and build session config. Returns (config, workflow_name) or raises."""
        db = SessionLocal()
        try:
            workflow = db.get(Workflow, wf_id)
            if not workflow:
                return None, None

            active_def = db.scalar(
                select(WorkflowDefinition).where(
                    WorkflowDefinition.workflow_id == wf_id,
                    WorkflowDefinition.is_active == True,  # noqa: E712
                )
            )
            if not active_def:
                return None, None

            steps = db.scalars(
                select(WorkflowStep)
                .where(WorkflowStep.definition_id == active_def.id)
                .order_by(WorkflowStep.position)
            ).all()

            tools_defs = _get_admin_voice_tools_definitions()
            config = _build_session_config(workflow, steps, tools_defs)
            return config, workflow.display_name
        finally:
            db.close()

    async def _list_all_workflows():
        """Return JSON string listing all workflows."""
        db = SessionLocal()
        try:
            workflows = db.scalars(
                select(Workflow).order_by(Workflow.display_name)
            ).all()
            items = [{"id": w.id, "name": w.display_name} for w in workflows]
            return json.dumps(items, ensure_ascii=False)
        finally:
            db.close()

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

        session_config, wf_name = await _load_workflow_context(workflow_id)
        if not session_config:
            await websocket.send_json({"type": "error", "message": "Workflow not found or no active definition"})
            return

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
        await websocket.send_json({"type": "ready", "workflow_name": wf_name})

        # Shared state for workflow switching
        switch_event = asyncio.Event()
        switch_target = {"workflow_id": None}

        # Relay tasks
        async def client_to_openai():
            """Forward audio from watch client to OpenAI."""
            nonlocal workflow_id
            try:
                while True:
                    msg = await websocket.receive_json()
                    msg_type = msg.get("type")

                    if msg_type == "audio":
                        await openai_ws.send(json.dumps({
                            "type": "input_audio_buffer.append",
                            "audio": msg["data"],
                        }))
                    elif msg_type == "switch_workflow":
                        # Client explicitly requests workflow switch
                        switch_target["workflow_id"] = msg.get("workflow_id")
                        switch_event.set()
                        return
                    elif msg_type == "stop":
                        break
            except WebSocketDisconnect:
                pass
            except Exception as e:
                logger.error(f"[VOICE_RELAY] Client→OpenAI error: {e}")

        async def openai_to_client():
            """Forward audio from OpenAI to watch client, handle tool calls."""
            nonlocal workflow_id
            try:
                async for raw_msg in openai_ws:
                    event = json.loads(raw_msg)
                    event_type = event.get("type", "")

                    if event_type == "response.audio.delta":
                        delta = event.get("delta", "")
                        if delta:
                            await websocket.send_json({
                                "type": "audio",
                                "data": delta,
                            })

                    elif event_type == "response.function_call_arguments.done":
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

                        # Handle switch_workflow tool
                        if tool_name == "switch_workflow":
                            target_id = args.get("workflow_id")
                            if target_id:
                                switch_target["workflow_id"] = target_id
                                # Send result to OpenAI before switching
                                await openai_ws.send(json.dumps({
                                    "type": "conversation.item.create",
                                    "item": {
                                        "type": "function_call_output",
                                        "call_id": call_id,
                                        "output": f"Switching to workflow {target_id}...",
                                    },
                                }))
                                switch_event.set()
                                return
                            else:
                                # List workflows
                                result = await _list_all_workflows()
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
                                continue

                        # Execute other tools
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

        # Main loop: supports workflow switching by reconnecting to OpenAI
        while True:
            switch_event.clear()

            done, pending = await asyncio.wait(
                [
                    asyncio.create_task(client_to_openai()),
                    asyncio.create_task(openai_to_client()),
                ],
                return_when=asyncio.FIRST_COMPLETED,
            )
            for task in pending:
                task.cancel()

            # Check if we need to switch workflows
            if not switch_event.is_set():
                break

            new_wf_id = switch_target["workflow_id"]
            logger.info(f"[VOICE_RELAY] Switching to workflow {new_wf_id}")

            # Close old OpenAI connection
            await openai_ws.close()

            new_config, new_name = await _load_workflow_context(new_wf_id)
            if not new_config:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Workflow {new_wf_id} not found",
                })
                break

            workflow_id = new_wf_id

            # Reconnect to OpenAI with new config
            openai_ws = await websockets.connect(
                f"{OPENAI_REALTIME_WS}?model={model}",
                additional_headers=headers,
                max_size=None,
            )
            await openai_ws.send(json.dumps(new_config))
            await websocket.send_json({
                "type": "ready",
                "workflow_name": new_name,
            })
            logger.info(f"[VOICE_RELAY] Switched to workflow '{new_name}' (id={new_wf_id})")

    except WebSocketDisconnect:
        logger.info("[VOICE_RELAY] Client disconnected")
    except Exception as e:
        logger.error(f"[VOICE_RELAY] Error: {e}", exc_info=True)
    finally:
        if openai_ws:
            await openai_ws.close()
        logger.info("[VOICE_RELAY] Session ended")
