"""GitHub integration API routes."""

from __future__ import annotations

import hashlib
import hmac
import logging
import uuid
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..config import Settings, get_settings
from ..database import get_session
from ..dependencies import get_current_user
from ..github.api_service import GitHubAPIService, GitHubAPIError
from ..github.oauth_service import (
    complete_github_oauth_callback,
    get_oauth_session_status,
    revoke_github_integration,
    start_github_oauth_flow,
)
from ..github.sync_service import WorkflowSyncService
from ..models import (
    GitHubIntegration,
    GitHubRepoSync,
    GitHubSyncTask,
    User,
    WorkflowGitHubMapping,
)
from ..schemas import (
    GitHubIntegrationResponse,
    GitHubOAuthStartResponse,
    GitHubOAuthStatusResponse,
    GitHubRepoResponse,
    GitHubRepoSyncCreateRequest,
    GitHubRepoSyncResponse,
    GitHubRepoSyncUpdateRequest,
    GitHubScanResponse,
    GitHubSyncTaskResponse,
    GitHubSyncTriggerRequest,
    WorkflowGitHubMappingResponse,
    WorkflowPushRequest,
    WorkflowPushResponse,
)
from ..tasks.github_sync import sync_repo_task, webhook_sync_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/github", tags=["github"])


# =============================================================================
# OAuth Endpoints
# =============================================================================


@router.post("/oauth/start", response_model=GitHubOAuthStartResponse)
async def start_oauth(
    request: Request,
    current_user: User = Depends(get_current_user),
    settings: Settings = Depends(get_settings),
):
    """Start GitHub OAuth flow."""
    # Build redirect URI from public base URL (for reverse proxy/tunnel setups)
    base_url = settings.backend_public_base_url.rstrip("/")
    # Remove /api suffix if present since we add it below
    if base_url.endswith("/api"):
        base_url = base_url[:-4]
    redirect_uri = f"{base_url}/api/github/oauth/callback"

    result = start_github_oauth_flow(
        user_id=current_user.id,
        redirect_uri=redirect_uri,
    )

    return GitHubOAuthStartResponse(
        authorization_url=result["authorization_url"],
        state=result["state"],
    )


@router.get("/oauth/callback")
async def oauth_callback(
    code: str,
    state: str,
    session: Session = Depends(get_session),
):
    """
    Handle GitHub OAuth callback.

    This endpoint is called by GitHub after user authorization.
    Returns an HTML page that closes the popup and notifies the opener.
    """
    try:
        integration = await complete_github_oauth_callback(code, state, session)

        # Return HTML that closes popup and notifies opener
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>GitHub Connected</title></head>
        <body>
            <h1>GitHub Connected Successfully!</h1>
            <p>You can close this window.</p>
            <script>
                if (window.opener) {{
                    window.opener.postMessage({{
                        type: 'github-oauth-success',
                        integrationId: {integration.id}
                    }}, '*');
                }}
                window.close();
            </script>
        </body>
        </html>
        """
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html)

    except ValueError as e:
        html = f"""
        <!DOCTYPE html>
        <html>
        <head><title>GitHub Connection Failed</title></head>
        <body>
            <h1>Connection Failed</h1>
            <p>{str(e)}</p>
            <script>
                if (window.opener) {{
                    window.opener.postMessage({{
                        type: 'github-oauth-error',
                        error: '{str(e)}'
                    }}, '*');
                }}
                setTimeout(() => window.close(), 3000);
            </script>
        </body>
        </html>
        """
        from fastapi.responses import HTMLResponse
        return HTMLResponse(content=html, status_code=400)


@router.get("/oauth/status/{state}", response_model=GitHubOAuthStatusResponse)
async def oauth_status(state: str):
    """Poll OAuth session status."""
    result = get_oauth_session_status(state)
    return GitHubOAuthStatusResponse(**result)


# =============================================================================
# Integration Endpoints
# =============================================================================


@router.get("/integrations", response_model=list[GitHubIntegrationResponse])
async def list_integrations(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List user's GitHub integrations."""
    integrations = session.scalars(
        select(GitHubIntegration).where(
            GitHubIntegration.user_id == current_user.id,
            GitHubIntegration.is_active == True,
        )
    ).all()

    return [
        GitHubIntegrationResponse(
            id=i.id,
            github_username=i.github_username,
            github_email=i.github_email,
            github_avatar_url=i.github_avatar_url,
            scopes=i.scopes,
            is_active=i.is_active,
            created_at=i.created_at,
            updated_at=i.updated_at,
            repo_syncs_count=len(i.repo_syncs),
        )
        for i in integrations
    ]


@router.delete("/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_integration(
    integration_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Revoke a GitHub integration."""
    integration = session.get(GitHubIntegration, integration_id)

    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    if integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    await revoke_github_integration(integration, session)


# =============================================================================
# Repository Endpoints
# =============================================================================


@router.get("/repos", response_model=list[GitHubRepoResponse])
async def list_repos(
    integration_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List accessible GitHub repositories."""
    integration = session.get(GitHubIntegration, integration_id)

    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    if integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        api = GitHubAPIService(integration)
        repos = await api.list_repos()

        return [
            GitHubRepoResponse(
                id=r["id"],
                full_name=r["full_name"],
                name=r["name"],
                owner=r["owner"]["login"],
                description=r.get("description"),
                private=r["private"],
                default_branch=r.get("default_branch", "main"),
                html_url=r["html_url"],
            )
            for r in repos
        ]
    except GitHubAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


# =============================================================================
# Repo Sync Endpoints
# =============================================================================


@router.post("/repo-syncs", response_model=GitHubRepoSyncResponse)
async def create_repo_sync(
    payload: GitHubRepoSyncCreateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Create a repository sync configuration."""
    integration = session.get(GitHubIntegration, payload.integration_id)

    if not integration:
        raise HTTPException(status_code=404, detail="Integration not found")

    if integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Check for duplicate
    existing = session.scalar(
        select(GitHubRepoSync).where(
            GitHubRepoSync.integration_id == payload.integration_id,
            GitHubRepoSync.repo_full_name == payload.repo_full_name,
            GitHubRepoSync.branch == payload.branch,
        )
    )
    if existing:
        raise HTTPException(
            status_code=400,
            detail="Sync configuration already exists for this repo/branch",
        )

    # Verify repo access
    try:
        api = GitHubAPIService(integration)
        await api.get_repo(payload.repo_full_name)
    except GitHubAPIError as e:
        if e.status_code == 404:
            raise HTTPException(status_code=404, detail="Repository not found or not accessible")
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))

    repo_sync = GitHubRepoSync(
        integration_id=payload.integration_id,
        repo_full_name=payload.repo_full_name,
        branch=payload.branch,
        file_pattern=payload.file_pattern,
        sync_direction=payload.sync_direction,
        auto_sync_enabled=payload.auto_sync_enabled,
    )
    session.add(repo_sync)
    session.commit()
    session.refresh(repo_sync)

    return _repo_sync_to_response(repo_sync)


@router.get("/repo-syncs", response_model=list[GitHubRepoSyncResponse])
async def list_repo_syncs(
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List repository sync configurations."""
    repo_syncs = session.scalars(
        select(GitHubRepoSync)
        .join(GitHubIntegration)
        .where(GitHubIntegration.user_id == current_user.id)
    ).all()

    return [_repo_sync_to_response(rs) for rs in repo_syncs]


@router.get("/repo-syncs/{sync_id}", response_model=GitHubRepoSyncResponse)
async def get_repo_sync(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get a repository sync configuration."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return _repo_sync_to_response(repo_sync)


@router.patch("/repo-syncs/{sync_id}", response_model=GitHubRepoSyncResponse)
async def update_repo_sync(
    sync_id: int,
    payload: GitHubRepoSyncUpdateRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Update a repository sync configuration."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Update fields
    if payload.branch is not None:
        repo_sync.branch = payload.branch
    if payload.file_pattern is not None:
        repo_sync.file_pattern = payload.file_pattern
    if payload.sync_direction is not None:
        repo_sync.sync_direction = payload.sync_direction
    if payload.auto_sync_enabled is not None:
        repo_sync.auto_sync_enabled = payload.auto_sync_enabled
    if payload.is_active is not None:
        repo_sync.is_active = payload.is_active

    session.commit()
    session.refresh(repo_sync)

    return _repo_sync_to_response(repo_sync)


@router.delete("/repo-syncs/{sync_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_repo_sync(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete a repository sync configuration."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    # Delete webhook if exists
    if repo_sync.webhook_id:
        try:
            api = GitHubAPIService(repo_sync.integration)
            await api.delete_webhook(repo_sync.repo_full_name, repo_sync.webhook_id)
        except Exception as e:
            logger.warning(f"Failed to delete webhook: {e}")

    session.delete(repo_sync)
    session.commit()


# =============================================================================
# Scan and Sync Endpoints
# =============================================================================


@router.get("/repo-syncs/{sync_id}/scan", response_model=GitHubScanResponse)
async def scan_repo_files(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Scan repository for files matching the pattern."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        sync_service = WorkflowSyncService(session)
        files = await sync_service.scan_repo_files(repo_sync)

        return GitHubScanResponse(
            repo_full_name=repo_sync.repo_full_name,
            branch=repo_sync.branch,
            file_pattern=repo_sync.file_pattern,
            files=[
                {
                    "file_path": f["file_path"],
                    "sha": f["sha"],
                    "size": f["size"],
                    "is_new": f["is_new"],
                    "mapped_workflow_id": f["mapped_workflow_id"],
                    "mapped_workflow_slug": f["mapped_workflow_slug"],
                }
                for f in files
            ],
            total_files=len(files),
        )
    except Exception as e:
        logger.exception(f"Scan failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/repo-syncs/{sync_id}/sync", response_model=GitHubSyncTaskResponse)
async def trigger_sync(
    sync_id: int,
    payload: GitHubSyncTriggerRequest = GitHubSyncTriggerRequest(),
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Trigger a manual sync operation."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not repo_sync.is_active:
        raise HTTPException(status_code=400, detail="Repo sync is disabled")

    # Create task record
    task_id = str(uuid.uuid4())
    task = GitHubSyncTask(
        task_id=task_id,
        repo_sync_id=sync_id,
        triggered_by_user_id=current_user.id,
        operation=payload.operation,
        status="pending",
    )
    session.add(task)
    session.commit()
    session.refresh(task)

    # Dispatch Celery task
    sync_repo_task.delay(task_id, sync_id, payload.operation)

    return _sync_task_to_response(task)


@router.get("/sync-tasks/{task_id}", response_model=GitHubSyncTaskResponse)
async def get_sync_task_status(
    task_id: str,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Get sync task status."""
    task = session.scalar(
        select(GitHubSyncTask).where(GitHubSyncTask.task_id == task_id)
    )

    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    if task.repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return _sync_task_to_response(task)


# =============================================================================
# Mappings Endpoints
# =============================================================================


@router.get(
    "/repo-syncs/{sync_id}/mappings",
    response_model=list[WorkflowGitHubMappingResponse],
)
async def list_mappings(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """List workflow mappings for a repo sync."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    return [_mapping_to_response(m) for m in repo_sync.workflow_mappings]


@router.post("/push-workflow", response_model=WorkflowPushResponse)
async def push_workflow_to_github(
    payload: WorkflowPushRequest,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Push a workflow to GitHub."""
    repo_sync = session.get(GitHubRepoSync, payload.repo_sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    try:
        sync_service = WorkflowSyncService(session)
        result = await sync_service.push_new_workflow(
            workflow_id=payload.workflow_id,
            repo_sync=repo_sync,
            file_path=payload.file_path,
            commit_message=payload.commit_message,
        )
        return WorkflowPushResponse(**result)
    except Exception as e:
        logger.exception(f"Push failed: {e}")
        return WorkflowPushResponse(
            success=False,
            file_path=payload.file_path or "",
            error=str(e),
        )


# =============================================================================
# Webhook Endpoint
# =============================================================================


@router.post("/webhooks")
async def github_webhook_receiver(
    request: Request,
    session: Session = Depends(get_session),
):
    """
    Receive GitHub webhook events.

    This endpoint receives push events from GitHub and triggers auto-sync
    if configured.
    """
    settings = get_settings()

    # Get signature header
    signature = request.headers.get("X-Hub-Signature-256")
    if not signature:
        raise HTTPException(status_code=400, detail="Missing signature header")

    # Get raw body for signature verification
    body = await request.body()

    # Parse payload
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Get event type
    event_type = request.headers.get("X-GitHub-Event")
    if event_type != "push":
        # Ignore non-push events
        return {"status": "ignored", "event": event_type}

    # Extract repo info
    repo_full_name = payload.get("repository", {}).get("full_name")
    ref = payload.get("ref", "")
    branch = ref.replace("refs/heads/", "") if ref.startswith("refs/heads/") else None

    if not repo_full_name or not branch:
        return {"status": "ignored", "reason": "Missing repo or branch"}

    # Find matching repo syncs
    repo_syncs = session.scalars(
        select(GitHubRepoSync).where(
            GitHubRepoSync.repo_full_name == repo_full_name,
            GitHubRepoSync.branch == branch,
            GitHubRepoSync.is_active == True,
            GitHubRepoSync.auto_sync_enabled == True,
            GitHubRepoSync.webhook_id.isnot(None),
        )
    ).all()

    if not repo_syncs:
        return {"status": "ignored", "reason": "No matching repo syncs"}

    # Verify signature for at least one repo sync
    verified = False
    for repo_sync in repo_syncs:
        if repo_sync.webhook_secret_encrypted:
            from ..secret_utils import decrypt_secret
            secret = decrypt_secret(repo_sync.webhook_secret_encrypted)
            if secret and _verify_webhook_signature(body, signature, secret):
                verified = True
                break

    if not verified:
        # Try with global webhook secret
        if settings.github_webhook_secret:
            if not _verify_webhook_signature(body, signature, settings.github_webhook_secret):
                raise HTTPException(status_code=401, detail="Invalid signature")
        else:
            raise HTTPException(status_code=401, detail="Invalid signature")

    # Extract changed files
    changed_files = set()
    for commit in payload.get("commits", []):
        changed_files.update(commit.get("added", []))
        changed_files.update(commit.get("modified", []))

    # Trigger sync for each matching repo sync
    for repo_sync in repo_syncs:
        webhook_sync_task.delay(repo_sync.id, list(changed_files))

    return {
        "status": "ok",
        "syncs_triggered": len(repo_syncs),
    }


@router.post("/repo-syncs/{sync_id}/webhook")
async def create_webhook(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
    request: Request = None,
):
    """Create a webhook for the repository."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if repo_sync.webhook_id:
        raise HTTPException(status_code=400, detail="Webhook already exists")

    # Build webhook URL
    webhook_url = str(request.base_url).rstrip("/") + "/api/github/webhooks"

    try:
        api = GitHubAPIService(repo_sync.integration)
        result, secret = await api.create_webhook(
            repo_sync.repo_full_name,
            webhook_url,
        )

        # Store webhook info
        from ..secret_utils import encrypt_secret
        repo_sync.webhook_id = result["id"]
        repo_sync.webhook_secret_encrypted = encrypt_secret(secret)
        session.commit()

        return {
            "status": "ok",
            "webhook_id": result["id"],
        }
    except GitHubAPIError as e:
        raise HTTPException(status_code=e.status_code or 500, detail=str(e))


@router.delete("/repo-syncs/{sync_id}/webhook", status_code=status.HTTP_204_NO_CONTENT)
async def delete_webhook(
    sync_id: int,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    """Delete the webhook for the repository."""
    repo_sync = session.get(GitHubRepoSync, sync_id)

    if not repo_sync:
        raise HTTPException(status_code=404, detail="Repo sync not found")

    if repo_sync.integration.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not repo_sync.webhook_id:
        raise HTTPException(status_code=400, detail="No webhook exists")

    try:
        api = GitHubAPIService(repo_sync.integration)
        await api.delete_webhook(repo_sync.repo_full_name, repo_sync.webhook_id)
    except GitHubAPIError as e:
        if e.status_code != 404:
            raise HTTPException(status_code=e.status_code or 500, detail=str(e))

    repo_sync.webhook_id = None
    repo_sync.webhook_secret_encrypted = None
    session.commit()


# =============================================================================
# Helper Functions
# =============================================================================


def _repo_sync_to_response(repo_sync: GitHubRepoSync) -> GitHubRepoSyncResponse:
    """Convert repo sync model to response."""
    return GitHubRepoSyncResponse(
        id=repo_sync.id,
        integration_id=repo_sync.integration_id,
        repo_full_name=repo_sync.repo_full_name,
        branch=repo_sync.branch,
        file_pattern=repo_sync.file_pattern,
        sync_direction=repo_sync.sync_direction,
        auto_sync_enabled=repo_sync.auto_sync_enabled,
        webhook_id=repo_sync.webhook_id,
        has_webhook=repo_sync.webhook_id is not None,
        last_sync_at=repo_sync.last_sync_at,
        last_sync_status=repo_sync.last_sync_status,
        last_sync_error=repo_sync.last_sync_error,
        is_active=repo_sync.is_active,
        created_at=repo_sync.created_at,
        updated_at=repo_sync.updated_at,
        mappings_count=len(repo_sync.workflow_mappings),
    )


def _sync_task_to_response(task: GitHubSyncTask) -> GitHubSyncTaskResponse:
    """Convert sync task model to response."""
    return GitHubSyncTaskResponse(
        task_id=task.task_id,
        repo_sync_id=task.repo_sync_id,
        operation=task.operation,
        status=task.status,
        progress=task.progress,
        files_processed=task.files_processed,
        files_total=task.files_total,
        result_summary=task.result_summary,
        error_message=task.error_message,
        started_at=task.started_at,
        completed_at=task.completed_at,
        created_at=task.created_at,
    )


def _mapping_to_response(mapping: WorkflowGitHubMapping) -> WorkflowGitHubMappingResponse:
    """Convert mapping model to response."""
    return WorkflowGitHubMappingResponse(
        id=mapping.id,
        workflow_id=mapping.workflow_id,
        workflow_slug=mapping.workflow.slug,
        workflow_display_name=mapping.workflow.display_name or mapping.workflow.slug,
        repo_sync_id=mapping.repo_sync_id,
        file_path=mapping.file_path,
        github_sha=mapping.github_sha,
        sync_status=mapping.sync_status,
        last_pull_at=mapping.last_pull_at,
        last_push_at=mapping.last_push_at,
        created_at=mapping.created_at,
        updated_at=mapping.updated_at,
    )


def _verify_webhook_signature(body: bytes, signature: str, secret: str) -> bool:
    """Verify GitHub webhook signature."""
    if not signature.startswith("sha256="):
        return False

    expected_signature = signature[7:]
    computed = hmac.new(
        secret.encode("utf-8"),
        body,
        hashlib.sha256,
    ).hexdigest()

    return hmac.compare_digest(computed, expected_signature)
