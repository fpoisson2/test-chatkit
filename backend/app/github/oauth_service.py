"""GitHub OAuth 2.0 authentication service."""

from __future__ import annotations

import logging
import secrets
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any, Literal
from urllib.parse import urlencode

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..config import get_settings
from ..models import GitHubIntegration, User
from ..secret_utils import encrypt_secret, mask_secret

logger = logging.getLogger("chatkit.github.oauth")

# GitHub OAuth endpoints
GITHUB_AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
GITHUB_TOKEN_URL = "https://github.com/login/oauth/access_token"
GITHUB_API_URL = "https://api.github.com"

# Required scopes for workflow sync
DEFAULT_SCOPES = ["repo", "admin:repo_hook"]

# Session TTL (5 minutes)
SESSION_TTL_SECONDS = 300


@dataclass
class GitHubOAuthSession:
    """In-memory OAuth session tracking."""

    state: str
    user_id: int
    redirect_uri: str
    scopes: list[str]
    expires_at: float
    status: Literal["pending", "ok", "error"] = "pending"
    integration_id: int | None = None
    error: str | None = None

    def remaining_seconds(self, *, now: float | None = None) -> int:
        current = time.time() if now is None else now
        return max(0, int(self.expires_at - current))

    def is_expired(self, *, now: float | None = None) -> bool:
        current = time.time() if now is None else now
        return current >= self.expires_at


# In-memory session store
_sessions: dict[str, GitHubOAuthSession] = {}
_sessions_lock = Lock()


def _generate_state() -> str:
    """Generate a secure random state parameter."""
    return secrets.token_urlsafe(24)


def _cleanup_expired_sessions(*, now: float | None = None) -> None:
    """Remove expired sessions from memory."""
    current = time.time() if now is None else now
    with _sessions_lock:
        expired = [
            state
            for state, session in _sessions.items()
            if session.is_expired(now=current)
        ]
        for state in expired:
            _sessions.pop(state, None)


def _store_session(session: GitHubOAuthSession) -> None:
    """Store an OAuth session."""
    _cleanup_expired_sessions()
    with _sessions_lock:
        _sessions[session.state] = session


def _get_session(state: str, *, now: float | None = None) -> GitHubOAuthSession | None:
    """Retrieve an OAuth session by state."""
    current = time.time() if now is None else now
    with _sessions_lock:
        session = _sessions.get(state)
        if session is None:
            return None
        if session.is_expired(now=current):
            _sessions.pop(state, None)
            return None
        return session


def _update_session(state: str, **updates: Any) -> None:
    """Update an OAuth session."""
    with _sessions_lock:
        session = _sessions.get(state)
        if session is None:
            return
        for key, value in updates.items():
            if hasattr(session, key):
                setattr(session, key, value)


def start_github_oauth_flow(
    user_id: int,
    redirect_uri: str,
    scopes: list[str] | None = None,
) -> dict[str, Any]:
    """
    Start GitHub OAuth flow.

    Args:
        user_id: The ID of the user initiating the flow
        redirect_uri: The callback URL for GitHub to redirect to
        scopes: Optional list of scopes (defaults to DEFAULT_SCOPES)

    Returns:
        Dictionary with authorization_url and state
    """
    settings = get_settings()

    if not settings.github_oauth_client_id:
        raise ValueError("GITHUB_OAUTH_CLIENT_ID is not configured")

    state = _generate_state()
    effective_scopes = scopes or DEFAULT_SCOPES

    # Store session
    session = GitHubOAuthSession(
        state=state,
        user_id=user_id,
        redirect_uri=redirect_uri,
        scopes=effective_scopes,
        expires_at=time.time() + SESSION_TTL_SECONDS,
    )
    _store_session(session)

    # Build authorization URL
    params = {
        "client_id": settings.github_oauth_client_id,
        "redirect_uri": redirect_uri,
        "scope": " ".join(effective_scopes),
        "state": state,
    }
    authorization_url = f"{GITHUB_AUTHORIZE_URL}?{urlencode(params)}"

    logger.info(f"Started GitHub OAuth flow for user {user_id}, state={state[:8]}...")

    return {
        "authorization_url": authorization_url,
        "state": state,
    }


async def complete_github_oauth_callback(
    code: str,
    state: str,
    session: Session,
) -> GitHubIntegration:
    """
    Complete GitHub OAuth callback.

    Args:
        code: The authorization code from GitHub
        state: The state parameter to validate
        session: Database session

    Returns:
        The created or updated GitHubIntegration

    Raises:
        ValueError: If state is invalid or expired
    """
    settings = get_settings()

    # Validate session
    oauth_session = _get_session(state)
    if oauth_session is None:
        raise ValueError("Invalid or expired OAuth state")

    if oauth_session.status != "pending":
        raise ValueError("OAuth flow already completed")

    try:
        # Exchange code for access token
        async with httpx.AsyncClient() as client:
            token_response = await client.post(
                GITHUB_TOKEN_URL,
                data={
                    "client_id": settings.github_oauth_client_id,
                    "client_secret": settings.github_oauth_client_secret,
                    "code": code,
                    "redirect_uri": oauth_session.redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            token_response.raise_for_status()
            token_data = token_response.json()

        if "error" in token_data:
            error_msg = token_data.get("error_description", token_data["error"])
            _update_session(state, status="error", error=error_msg)
            raise ValueError(f"GitHub OAuth error: {error_msg}")

        access_token = token_data.get("access_token")
        if not access_token:
            _update_session(state, status="error", error="No access token received")
            raise ValueError("No access token received from GitHub")

        # Get user info from GitHub
        async with httpx.AsyncClient() as client:
            user_response = await client.get(
                f"{GITHUB_API_URL}/user",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Accept": "application/vnd.github+json",
                },
            )
            user_response.raise_for_status()
            github_user = user_response.json()

        # Check for existing integration
        existing = session.scalar(
            select(GitHubIntegration).where(
                GitHubIntegration.user_id == oauth_session.user_id,
                GitHubIntegration.github_user_id == github_user["id"],
            )
        )

        if existing:
            # Update existing integration
            existing.access_token_encrypted = encrypt_secret(access_token)
            existing.access_token_hint = mask_secret(access_token)
            existing.github_username = github_user["login"]
            existing.github_email = github_user.get("email")
            existing.github_avatar_url = github_user.get("avatar_url")
            existing.scopes = ",".join(oauth_session.scopes)
            existing.is_active = True

            # Handle refresh token if provided
            refresh_token = token_data.get("refresh_token")
            if refresh_token:
                existing.refresh_token_encrypted = encrypt_secret(refresh_token)
                existing.refresh_token_hint = mask_secret(refresh_token)

            # Handle expiration if provided
            expires_in = token_data.get("expires_in")
            if expires_in:
                import datetime

                existing.token_expires_at = datetime.datetime.now(
                    datetime.UTC
                ) + datetime.timedelta(seconds=expires_in)

            session.commit()
            session.refresh(existing)
            integration = existing
            logger.info(
                f"Updated GitHub integration {integration.id} for user {oauth_session.user_id}"
            )
        else:
            # Create new integration
            import datetime

            integration = GitHubIntegration(
                user_id=oauth_session.user_id,
                access_token_encrypted=encrypt_secret(access_token),
                access_token_hint=mask_secret(access_token),
                github_user_id=github_user["id"],
                github_username=github_user["login"],
                github_email=github_user.get("email"),
                github_avatar_url=github_user.get("avatar_url"),
                scopes=",".join(oauth_session.scopes),
            )

            # Handle refresh token if provided
            refresh_token = token_data.get("refresh_token")
            if refresh_token:
                integration.refresh_token_encrypted = encrypt_secret(refresh_token)
                integration.refresh_token_hint = mask_secret(refresh_token)

            # Handle expiration if provided
            expires_in = token_data.get("expires_in")
            if expires_in:
                integration.token_expires_at = datetime.datetime.now(
                    datetime.UTC
                ) + datetime.timedelta(seconds=expires_in)

            session.add(integration)
            session.commit()
            session.refresh(integration)
            logger.info(
                f"Created GitHub integration {integration.id} for user {oauth_session.user_id}"
            )

        # Update session status
        _update_session(state, status="ok", integration_id=integration.id)

        return integration

    except httpx.HTTPStatusError as e:
        error_msg = f"GitHub API error: {e.response.status_code}"
        _update_session(state, status="error", error=error_msg)
        logger.error(f"GitHub OAuth failed: {error_msg}")
        raise ValueError(error_msg) from e
    except Exception as e:
        error_msg = str(e)
        _update_session(state, status="error", error=error_msg)
        logger.error(f"GitHub OAuth failed: {error_msg}")
        raise


def get_oauth_session_status(state: str) -> dict[str, Any]:
    """
    Get the status of an OAuth session (for polling).

    Args:
        state: The state parameter

    Returns:
        Dictionary with status, error, integration_id, remaining_seconds
    """
    session = _get_session(state)
    if session is None:
        return {
            "status": "error",
            "error": "Invalid or expired OAuth state",
            "integration_id": None,
            "remaining_seconds": 0,
        }

    return {
        "status": session.status,
        "error": session.error,
        "integration_id": session.integration_id,
        "remaining_seconds": session.remaining_seconds(),
    }


async def revoke_github_integration(
    integration: GitHubIntegration,
    session: Session,
) -> None:
    """
    Revoke a GitHub integration.

    This deletes the integration from the database. The GitHub OAuth token
    is not revoked on GitHub's side (user can do that manually in GitHub settings).

    Args:
        integration: The integration to revoke
        session: Database session
    """
    integration_id = integration.id
    user_id = integration.user_id

    # Delete the integration (cascades to repo_syncs)
    session.delete(integration)
    session.commit()

    logger.info(f"Revoked GitHub integration {integration_id} for user {user_id}")
