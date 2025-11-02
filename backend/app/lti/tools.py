"""LTI Tools - Tools that agents can use to interact with LTI platforms"""

from __future__ import annotations

import datetime
import logging
from typing import Any

import httpx
from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..database import SessionLocal
from ..models import LTISession, LTIPlatform

logger = logging.getLogger("chatkit.server")


async def submit_lti_grade(
    score: float,
    score_maximum: float = 100.0,
    comment: str | None = None,
    _agent_context: Any = None,
) -> str:
    """
    Submit a grade to the Learning Management System (LMS) via LTI Assignment and Grade Services.

    This tool allows you to send student scores back to their LMS gradebook. The grade is
    associated with the current LTI activity/assignment.

    Args:
        score: The score achieved by the student (e.g., 85 for 85 points)
        score_maximum: The maximum possible score (default: 100)
        comment: Optional comment or feedback about the performance

    Returns:
        A confirmation message indicating whether the grade was successfully submitted

    Example:
        - Student scored 17 out of 20: submit_lti_grade(score=17, score_maximum=20)
        - Student got 85%: submit_lti_grade(score=85, score_maximum=100, comment="Excellent work!")
        - Perfect score: submit_lti_grade(score=100)
    """

    # Get thread_id from agent context
    thread_id = None
    if _agent_context and hasattr(_agent_context, "thread_id"):
        thread_id = _agent_context.thread_id
    elif _agent_context and hasattr(_agent_context, "metadata"):
        metadata = getattr(_agent_context, "metadata", {})
        if isinstance(metadata, dict):
            thread_id = metadata.get("thread_id")

    if not thread_id:
        return "❌ Erreur: Impossible de déterminer le contexte LTI. Cet outil ne peut être utilisé que dans un contexte LTI."

    # Get LTI session from database
    with SessionLocal() as session:
        stmt = select(LTISession).where(LTISession.thread_id == thread_id)
        lti_session = session.execute(stmt).scalar_one_or_none()

        if not lti_session:
            return "❌ Erreur: Aucune session LTI trouvée. Cet outil ne peut être utilisé que dans un contexte LTI."

        # Check if we have AGS capability
        if not lti_session.ags_lineitem_url:
            return "❌ Erreur: Cette activité LTI ne supporte pas l'envoi de notes (AGS non configuré)."

        # Check scope
        if not lti_session.ags_scope or "https://purl.imsglobal.org/spec/lti-ags/scope/score" not in lti_session.ags_scope:
            return "❌ Erreur: Permission insuffisante pour envoyer des notes."

        # Get platform for OAuth token
        stmt = select(LTIPlatform).where(LTIPlatform.id == lti_session.platform_id)
        platform = session.execute(stmt).scalar_one_or_none()

        if not platform:
            return "❌ Erreur: Plateforme LTI introuvable."

        # Get access token
        try:
            access_token = await _get_platform_access_token(
                platform, lti_session.ags_scope, session
            )
        except Exception as e:
            logger.error(f"Failed to get access token: {e}")
            return f"❌ Erreur: Impossible d'obtenir un jeton d'accès ({str(e)})"

        # Build score payload
        score_payload = {
            "timestamp": datetime.datetime.now(datetime.UTC).isoformat(),
            "scoreGiven": score,
            "scoreMaximum": score_maximum,
            "activityProgress": "Completed",
            "gradingProgress": "FullyGraded",
            "userId": lti_session.launch_data.get("sub"),
        }

        if comment:
            score_payload["comment"] = comment

        # Submit score
        try:
            response = await httpx.AsyncClient().post(
                f"{lti_session.ags_lineitem_url}/scores",
                json=score_payload,
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/vnd.ims.lis.v1.score+json",
                },
                timeout=10.0,
            )
            response.raise_for_status()

            # Update session in database
            lti_session.score = score
            lti_session.score_maximum = score_maximum
            lti_session.score_submitted = True
            lti_session.score_submitted_at = datetime.datetime.now(datetime.UTC)
            session.commit()

            percentage = (score / score_maximum * 100) if score_maximum > 0 else 0
            logger.info(
                f"Grade submitted successfully: {score}/{score_maximum} ({percentage:.1f}%) "
                f"for LTI session {lti_session.session_id}"
            )

            return (
                f"✅ Note envoyée avec succès: {score}/{score_maximum} ({percentage:.1f}%). "
                f"La note a été enregistrée dans le carnet de notes du cours."
            )

        except httpx.HTTPStatusError as e:
            logger.error(f"Failed to submit grade: HTTP {e.response.status_code} - {e.response.text}")
            return f"❌ Erreur lors de l'envoi de la note: Le serveur LMS a retourné une erreur ({e.response.status_code})"
        except Exception as e:
            logger.error(f"Failed to submit grade: {e}")
            return f"❌ Erreur lors de l'envoi de la note: {str(e)}"


async def _get_platform_access_token(
    platform: LTIPlatform, scopes: list[str], session: Session
) -> str:
    """Get OAuth access token from platform"""
    import jwt
    import uuid
    from cryptography.hazmat.primitives import serialization

    # Build client assertion JWT
    now = datetime.datetime.now(datetime.UTC)
    assertion_payload = {
        "iss": platform.client_id,
        "sub": platform.client_id,
        "aud": platform.auth_token_url,
        "exp": int((now + datetime.timedelta(minutes=5)).timestamp()),
        "iat": int(now.timestamp()),
        "jti": str(uuid.uuid4()),
    }

    # Sign with platform's private key
    if not platform.private_key:
        raise HTTPException(status_code=500, detail="Platform private key not configured")

    private_key = serialization.load_pem_private_key(
        platform.private_key.encode(), password=None
    )
    client_assertion = jwt.encode(assertion_payload, private_key, algorithm="RS256")

    # Request access token
    async with httpx.AsyncClient() as client:
        response = await client.post(
            platform.auth_token_url,
            data={
                "grant_type": "client_credentials",
                "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
                "client_assertion": client_assertion,
                "scope": " ".join(scopes),
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10.0,
        )
        response.raise_for_status()

        token_data = response.json()
        return token_data["access_token"]
