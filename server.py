import os
import uuid

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel


class SessionRequest(BaseModel):
    user: str | None = None


load_dotenv()

app = FastAPI()

_openai_api_key = os.environ.get("OPENAI_API_KEY")
if not _openai_api_key:
    raise RuntimeError("OPENAI_API_KEY environment variable is required")

_workflow_id = os.environ.get("CHATKIT_WORKFLOW_ID")
if not _workflow_id:
    raise RuntimeError("CHATKIT_WORKFLOW_ID environment variable is required")

_chatkit_api_base = os.environ.get("CHATKIT_API_BASE", "https://api.openai.com")


async def _create_chatkit_session(user_id: str) -> dict:
    async with httpx.AsyncClient(base_url=_chatkit_api_base, timeout=30) as client:
        response = await client.post(
            "/v1/chatkit/sessions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {_openai_api_key}",
                "OpenAI-Beta": "chatkit_beta=v1",
            },
            json={
                "workflow": {"id": _workflow_id},
                "user": user_id,
            },
        )
    if response.status_code >= 400:
        try:
            detail = response.json()
        except ValueError:
            detail = {"error": response.text}
        raise HTTPException(
            status_code=response.status_code,
            detail={
                "error": f"ChatKit session creation failed: {response.status_code}",
                "details": detail,
            },
        )
    return response.json()


@app.post("/api/chatkit/session")
async def create_chatkit_session(req: SessionRequest):
    user_id = req.user or str(uuid.uuid4())
    session_payload = await _create_chatkit_session(user_id)
    client_secret = session_payload.get("client_secret")
    if not client_secret:
        raise HTTPException(
            status_code=500,
            detail={
                "error": "ChatKit response missing client_secret",
                "details": session_payload,
            },
        )
    return {
        "client_secret": client_secret,
        "expires_after": session_payload.get("expires_after"),
    }
