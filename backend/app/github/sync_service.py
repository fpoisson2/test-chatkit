"""Workflow synchronization service for GitHub."""

from __future__ import annotations

import datetime
import json
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from ..models import (
    GitHubIntegration,
    GitHubRepoSync,
    Workflow,
    WorkflowDefinition,
    WorkflowGitHubMapping,
)
from ..workflows.service import WorkflowPersistenceService, serialize_definition_graph
from .api_service import GitHubAPIService, GitHubAPIError

logger = logging.getLogger("chatkit.github.sync")


def _json_serial(obj: Any) -> str:
    """JSON serializer for objects not serializable by default json code."""
    if isinstance(obj, datetime.datetime):
        return obj.isoformat()
    if isinstance(obj, datetime.date):
        return obj.isoformat()
    raise TypeError(f"Type {type(obj)} not serializable")


class SyncError(Exception):
    """Synchronization error."""

    pass


class ConflictError(SyncError):
    """Conflict detected during sync."""

    def __init__(self, message: str, mapping: WorkflowGitHubMapping):
        super().__init__(message)
        self.mapping = mapping


class WorkflowSyncService:
    """Service for synchronizing workflows with GitHub repositories."""

    def __init__(self, session: Session):
        """
        Initialize the sync service.

        Args:
            session: Database session
        """
        self.session = session
        self.workflow_service = WorkflowPersistenceService()

    def _get_api_service(self, repo_sync: GitHubRepoSync) -> GitHubAPIService:
        """Get GitHub API service for a repo sync."""
        integration = repo_sync.integration
        if not integration or not integration.is_active:
            raise SyncError("GitHub integration is not active")
        return GitHubAPIService(integration)

    async def scan_repo_files(
        self,
        repo_sync: GitHubRepoSync,
    ) -> list[dict[str, Any]]:
        """
        Scan repository for files matching the pattern.

        Args:
            repo_sync: Repository sync configuration

        Returns:
            List of file info dicts with existing mapping info
        """
        api = self._get_api_service(repo_sync)

        # Get matching files from GitHub
        files = await api.scan_files_matching_pattern(
            repo_sync.repo_full_name,
            repo_sync.branch,
            repo_sync.file_pattern,
        )

        # Get existing mappings
        existing_mappings = {
            m.file_path: m
            for m in repo_sync.workflow_mappings
        }

        result = []
        for file_info in files:
            file_path = file_info["path"]
            mapping = existing_mappings.get(file_path)

            result.append({
                "file_path": file_path,
                "sha": file_info["sha"],
                "size": file_info["size"],
                "is_new": mapping is None,
                "mapped_workflow_id": mapping.workflow_id if mapping else None,
                "mapped_workflow_slug": mapping.workflow.slug if mapping else None,
            })

        return result

    async def pull_workflows(
        self,
        repo_sync: GitHubRepoSync,
        progress_callback: callable | None = None,
    ) -> dict[str, Any]:
        """
        Pull workflows from GitHub to local database.

        Args:
            repo_sync: Repository sync configuration
            progress_callback: Optional callback for progress updates

        Returns:
            Summary of sync operation
        """
        api = self._get_api_service(repo_sync)

        # Get matching files
        files = await api.scan_files_matching_pattern(
            repo_sync.repo_full_name,
            repo_sync.branch,
            repo_sync.file_pattern,
        )

        total_files = len(files)
        imported = 0
        updated = 0
        skipped = 0
        errors = []

        # Get existing mappings
        existing_mappings = {
            m.file_path: m
            for m in repo_sync.workflow_mappings
        }

        for i, file_info in enumerate(files):
            file_path = file_info["path"]
            file_sha = file_info["sha"]

            if progress_callback:
                progress_callback(
                    current=i + 1,
                    total=total_files,
                    message=f"Processing {file_path}",
                )

            try:
                mapping = existing_mappings.get(file_path)

                # Check if file changed
                if mapping and mapping.github_sha == file_sha:
                    skipped += 1
                    logger.debug(f"Skipping unchanged file: {file_path}")
                    continue

                # Fetch file content
                content, sha = await api.get_file_content(
                    repo_sync.repo_full_name,
                    file_path,
                    repo_sync.branch,
                )

                # Parse JSON
                try:
                    graph_payload = json.loads(content)
                except json.JSONDecodeError as e:
                    errors.append({
                        "file_path": file_path,
                        "error": f"Invalid JSON: {e}",
                    })
                    continue

                # Validate it looks like a workflow
                if "nodes" not in graph_payload or "edges" not in graph_payload:
                    errors.append({
                        "file_path": file_path,
                        "error": "Missing 'nodes' or 'edges' in workflow JSON",
                    })
                    continue

                # Generate slug from filename if needed
                slug = self._generate_slug_from_path(file_path)

                if mapping:
                    # Update existing workflow
                    workflow = mapping.workflow

                    # Check for conflict
                    if mapping.sync_status == "local_changes":
                        mapping.sync_status = "conflict"
                        self.session.commit()
                        errors.append({
                            "file_path": file_path,
                            "error": "Conflict: local changes exist",
                        })
                        continue

                    # Import as new version
                    definition = self.workflow_service.import_workflow(
                        graph_payload=graph_payload,
                        session=self.session,
                        workflow_id=workflow.id,
                        version_name=f"GitHub sync: {sha[:7]}",
                        mark_as_active=True,
                    )

                    # Update mapping
                    mapping.github_sha = sha
                    mapping.last_synced_version_id = definition.id
                    mapping.sync_status = "synced"
                    mapping.last_pull_at = datetime.datetime.now(datetime.UTC)
                    updated += 1

                    logger.info(f"Updated workflow {workflow.slug} from {file_path}")

                else:
                    # Create new workflow
                    display_name = self._generate_display_name_from_path(file_path)

                    definition = self.workflow_service.import_workflow(
                        graph_payload=graph_payload,
                        session=self.session,
                        slug=slug,
                        display_name=display_name,
                        version_name="Initial import from GitHub",
                        mark_as_active=True,
                    )

                    # Create mapping
                    mapping = WorkflowGitHubMapping(
                        workflow_id=definition.workflow_id,
                        repo_sync_id=repo_sync.id,
                        file_path=file_path,
                        github_sha=sha,
                        last_synced_version_id=definition.id,
                        sync_status="synced",
                        last_pull_at=datetime.datetime.now(datetime.UTC),
                    )
                    self.session.add(mapping)
                    imported += 1

                    logger.info(f"Imported new workflow {slug} from {file_path}")

                self.session.commit()

            except Exception as e:
                logger.exception(f"Error processing {file_path}: {e}")
                errors.append({
                    "file_path": file_path,
                    "error": str(e),
                })
                self.session.rollback()

        # Update repo sync status
        repo_sync.last_sync_at = datetime.datetime.now(datetime.UTC)
        repo_sync.last_sync_status = "success" if not errors else "partial"
        repo_sync.last_sync_error = (
            f"{len(errors)} errors" if errors else None
        )
        self.session.commit()

        return {
            "operation": "pull",
            "total_files": total_files,
            "imported": imported,
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

    async def push_workflow(
        self,
        mapping: WorkflowGitHubMapping,
        commit_message: str | None = None,
    ) -> dict[str, Any]:
        """
        Push a workflow to GitHub.

        Args:
            mapping: Workflow-GitHub mapping
            commit_message: Optional commit message

        Returns:
            Push result
        """
        repo_sync = mapping.repo_sync
        api = self._get_api_service(repo_sync)
        workflow = mapping.workflow

        # Get active version
        active_version = self.session.get(
            WorkflowDefinition,
            workflow.active_version_id,
        )
        if not active_version:
            raise SyncError(f"Workflow {workflow.slug} has no active version")

        # Export workflow to JSON
        graph = serialize_definition_graph(active_version)
        content = json.dumps(graph, indent=2, ensure_ascii=False, default=_json_serial)

        # Check for remote changes (conflict detection)
        try:
            _, remote_sha = await api.get_file_content(
                repo_sync.repo_full_name,
                mapping.file_path,
                repo_sync.branch,
            )

            if mapping.github_sha and remote_sha != mapping.github_sha:
                # Remote file changed since last sync
                mapping.sync_status = "conflict"
                self.session.commit()
                raise ConflictError(
                    f"Remote file {mapping.file_path} has changed since last sync",
                    mapping,
                )

            # File exists, update it
            sha_for_update = remote_sha

        except GitHubAPIError as e:
            if e.status_code == 404:
                # File doesn't exist, create it
                sha_for_update = None
            else:
                raise

        # Generate commit message
        if not commit_message:
            commit_message = f"Update workflow: {workflow.display_name or workflow.slug}"

        # Push to GitHub
        result = await api.create_or_update_file(
            repo_sync.repo_full_name,
            mapping.file_path,
            content,
            commit_message,
            sha=sha_for_update,
            branch=repo_sync.branch,
        )

        # Update mapping
        new_sha = result.get("content", {}).get("sha")
        commit_sha = result.get("commit", {}).get("sha")

        mapping.github_sha = new_sha
        mapping.github_commit_sha = commit_sha
        mapping.last_synced_version_id = active_version.id
        mapping.sync_status = "synced"
        mapping.last_push_at = datetime.datetime.now(datetime.UTC)
        self.session.commit()

        logger.info(
            f"Pushed workflow {workflow.slug} to {repo_sync.repo_full_name}/{mapping.file_path}"
        )

        return {
            "success": True,
            "file_path": mapping.file_path,
            "commit_sha": commit_sha,
            "html_url": result.get("content", {}).get("html_url"),
        }

    async def push_new_workflow(
        self,
        workflow_id: int,
        repo_sync: GitHubRepoSync,
        file_path: str | None = None,
        commit_message: str | None = None,
    ) -> dict[str, Any]:
        """
        Push a workflow to GitHub for the first time.

        Args:
            workflow_id: Workflow to push
            repo_sync: Target repository sync config
            file_path: Optional file path (auto-generated if not provided)
            commit_message: Optional commit message

        Returns:
            Push result with mapping info
        """
        workflow = self.session.get(Workflow, workflow_id)
        if not workflow:
            raise SyncError(f"Workflow {workflow_id} not found")

        # Check if already mapped
        existing = self.session.scalar(
            select(WorkflowGitHubMapping).where(
                WorkflowGitHubMapping.workflow_id == workflow_id,
                WorkflowGitHubMapping.repo_sync_id == repo_sync.id,
            )
        )
        if existing:
            raise SyncError(
                f"Workflow {workflow.slug} is already mapped to {existing.file_path}"
            )

        # Generate file path if not provided
        if not file_path:
            # Extract directory from pattern
            pattern = repo_sync.file_pattern
            if "/" in pattern:
                directory = pattern.rsplit("/", 1)[0]
                if "*" in directory:
                    directory = directory.split("*")[0].rstrip("/")
            else:
                directory = ""

            file_name = f"{workflow.slug}.json"
            file_path = f"{directory}/{file_name}" if directory else file_name

        # Create mapping
        mapping = WorkflowGitHubMapping(
            workflow_id=workflow_id,
            repo_sync_id=repo_sync.id,
            file_path=file_path,
            sync_status="pending",
        )
        self.session.add(mapping)
        self.session.flush()

        # Push the workflow
        try:
            result = await self.push_workflow(mapping, commit_message)
            return result
        except Exception:
            self.session.rollback()
            raise

    async def sync_bidirectional(
        self,
        repo_sync: GitHubRepoSync,
        progress_callback: callable | None = None,
    ) -> dict[str, Any]:
        """
        Bidirectional sync: pull from GitHub, then push local changes.

        Args:
            repo_sync: Repository sync configuration
            progress_callback: Optional callback for progress updates

        Returns:
            Combined sync summary
        """
        # First, pull from GitHub
        pull_result = await self.pull_workflows(repo_sync, progress_callback)

        # Then, push any local changes
        push_results = []
        push_errors = []

        for mapping in repo_sync.workflow_mappings:
            if mapping.sync_status in ("local_changes", "pending"):
                try:
                    result = await self.push_workflow(mapping)
                    push_results.append(result)
                except ConflictError as e:
                    push_errors.append({
                        "file_path": mapping.file_path,
                        "error": str(e),
                    })
                except Exception as e:
                    push_errors.append({
                        "file_path": mapping.file_path,
                        "error": str(e),
                    })

        return {
            "operation": "sync",
            "pull": pull_result,
            "push": {
                "pushed": len(push_results),
                "errors": push_errors,
            },
        }

    def mark_local_changes(self, workflow_id: int) -> None:
        """
        Mark that a workflow has local changes (called when workflow is edited).

        Args:
            workflow_id: Workflow that was modified
        """
        mappings = self.session.scalars(
            select(WorkflowGitHubMapping).where(
                WorkflowGitHubMapping.workflow_id == workflow_id,
                WorkflowGitHubMapping.sync_status == "synced",
            )
        ).all()

        for mapping in mappings:
            mapping.sync_status = "local_changes"

        if mappings:
            self.session.commit()
            logger.debug(
                f"Marked {len(mappings)} mappings as having local changes "
                f"for workflow {workflow_id}"
            )

    def _generate_slug_from_path(self, file_path: str) -> str:
        """Generate a workflow slug from a file path."""
        # Get filename without extension
        filename = file_path.rsplit("/", 1)[-1]
        if filename.endswith(".json"):
            filename = filename[:-5]

        # Clean up for slug
        slug = filename.lower()
        slug = slug.replace(" ", "-")
        slug = "".join(c for c in slug if c.isalnum() or c == "-")
        slug = slug.strip("-")

        # Ensure uniqueness
        base_slug = slug
        counter = 1
        while self.session.scalar(
            select(Workflow.id).where(Workflow.slug == slug)
        ):
            slug = f"{base_slug}-{counter}"
            counter += 1

        return slug

    def _generate_display_name_from_path(self, file_path: str) -> str:
        """Generate a display name from a file path."""
        filename = file_path.rsplit("/", 1)[-1]
        if filename.endswith(".json"):
            filename = filename[:-5]

        # Convert to title case
        display_name = filename.replace("-", " ").replace("_", " ").title()

        return display_name
