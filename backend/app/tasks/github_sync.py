"""Celery tasks for GitHub workflow synchronization."""

from __future__ import annotations

import asyncio
import datetime
import logging

from sqlalchemy import select

from ..celery_app import celery_app
from ..database import SessionLocal
from ..models import GitHubRepoSync, GitHubSyncTask

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, name="app.tasks.github_sync.sync_repo_task")
def sync_repo_task(
    self,
    task_id: str,
    repo_sync_id: int,
    operation: str = "sync",
):
    """
    Background task to sync workflows with GitHub repository.

    Args:
        self: Celery task instance
        task_id: Task ID in database
        repo_sync_id: GitHubRepoSync ID
        operation: "pull", "push", or "sync" (bidirectional)
    """
    from ..github.sync_service import WorkflowSyncService

    try:
        with SessionLocal() as session:
            # Load task
            task = session.scalar(
                select(GitHubSyncTask).where(GitHubSyncTask.task_id == task_id)
            )
            if not task:
                logger.error(f"Task {task_id} not found in database")
                return {"status": "error", "error": "Task not found"}

            try:
                # Update status to running
                task.status = "running"
                task.progress = 10
                task.started_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 10,
                        "total": 100,
                        "status": "Loading repository configuration...",
                    },
                )

                # Load repo sync
                repo_sync = session.get(GitHubRepoSync, repo_sync_id)
                if not repo_sync:
                    raise ValueError(f"RepoSync {repo_sync_id} not found")

                if not repo_sync.is_active:
                    raise ValueError("Repository sync is disabled")

                # Update progress
                task.progress = 20
                session.commit()

                self.update_state(
                    state="PROGRESS",
                    meta={
                        "current": 20,
                        "total": 100,
                        "status": "Connecting to GitHub...",
                    },
                )

                # Create sync service
                sync_service = WorkflowSyncService(session)

                # Progress callback
                def progress_callback(current: int, total: int, message: str):
                    # Map file progress to 30-90 range
                    if total > 0:
                        file_progress = int(30 + (current / total) * 60)
                    else:
                        file_progress = 30

                    task.progress = file_progress
                    task.files_processed = current
                    task.files_total = total
                    session.commit()

                    self.update_state(
                        state="PROGRESS",
                        meta={
                            "current": file_progress,
                            "total": 100,
                            "status": message,
                            "files_processed": current,
                            "files_total": total,
                        },
                    )

                # Execute sync operation
                if operation == "pull":
                    result = asyncio.run(
                        sync_service.pull_workflows(repo_sync, progress_callback)
                    )
                elif operation == "push":
                    # Push all pending local changes
                    push_results = []
                    push_errors = []

                    mappings_to_push = [
                        m for m in repo_sync.workflow_mappings
                        if m.sync_status in ("local_changes", "pending")
                    ]

                    for i, mapping in enumerate(mappings_to_push):
                        progress_callback(
                            i + 1,
                            len(mappings_to_push),
                            f"Pushing {mapping.file_path}",
                        )
                        try:
                            push_result = asyncio.run(
                                sync_service.push_workflow(mapping)
                            )
                            push_results.append(push_result)
                        except Exception as e:
                            push_errors.append({
                                "file_path": mapping.file_path,
                                "error": str(e),
                            })

                    result = {
                        "operation": "push",
                        "pushed": len(push_results),
                        "errors": push_errors,
                    }
                else:
                    # Bidirectional sync
                    result = asyncio.run(
                        sync_service.sync_bidirectional(repo_sync, progress_callback)
                    )

                # Update task as completed
                task.status = "completed"
                task.progress = 100
                task.result_summary = result
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()

                logger.info(f"Sync task {task_id} completed successfully")

                return {"status": "completed", "result": result}

            except Exception as e:
                logger.exception(f"Task {task_id} failed: {e}")
                task.status = "failed"
                task.error_message = str(e)
                task.progress = 0
                task.completed_at = datetime.datetime.now(datetime.UTC)
                session.commit()
                raise

    except Exception as e:
        logger.exception(f"Fatal error in task {task_id}: {e}")
        raise


@celery_app.task(bind=True, name="app.tasks.github_sync.webhook_sync_task")
def webhook_sync_task(
    self,
    repo_sync_id: int,
    changed_files: list[str],
):
    """
    Background task triggered by GitHub webhook.

    Args:
        self: Celery task instance
        repo_sync_id: GitHubRepoSync ID
        changed_files: List of changed file paths from push event
    """
    import fnmatch

    from ..github.sync_service import WorkflowSyncService

    try:
        with SessionLocal() as session:
            repo_sync = session.get(GitHubRepoSync, repo_sync_id)
            if not repo_sync:
                logger.error(f"RepoSync {repo_sync_id} not found")
                return

            if not repo_sync.is_active or not repo_sync.auto_sync_enabled:
                logger.info(f"Auto-sync disabled for repo sync {repo_sync_id}")
                return

            # Filter changed files by pattern
            matching_files = [
                f for f in changed_files
                if fnmatch.fnmatch(f, repo_sync.file_pattern)
            ]

            if not matching_files:
                logger.debug(f"No matching files in webhook for repo sync {repo_sync_id}")
                return

            logger.info(
                f"Webhook triggered sync for {len(matching_files)} files "
                f"in repo sync {repo_sync_id}"
            )

            # Create sync service and pull
            sync_service = WorkflowSyncService(session)
            result = asyncio.run(sync_service.pull_workflows(repo_sync))

            logger.info(f"Webhook sync completed: {result}")

            # Notify connected WebSocket clients
            try:
                from ..routes.github_ws import notify_github_sync_complete

                workflows_affected = result.get("imported", []) + result.get("updated", [])
                asyncio.run(
                    notify_github_sync_complete(
                        repo_full_name=repo_sync.repo_full_name,
                        branch=repo_sync.branch,
                        sync_type="pull",
                        workflows_affected=workflows_affected,
                    )
                )
            except Exception as notify_err:
                logger.warning(f"Failed to send WebSocket notification: {notify_err}")

    except Exception as e:
        logger.exception(f"Webhook sync failed for repo sync {repo_sync_id}: {e}")
        raise
