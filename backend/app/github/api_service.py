"""GitHub REST API client service."""

from __future__ import annotations

import base64
import fnmatch
import logging
import secrets
from typing import Any
from urllib.parse import quote

import httpx

from ..models import GitHubIntegration
from ..secret_utils import decrypt_secret, encrypt_secret

logger = logging.getLogger("chatkit.github.api")

GITHUB_API_URL = "https://api.github.com"


def _encode_path(path: str) -> str:
    """Encode a file path for use in GitHub API URLs.

    Encodes each path segment individually to preserve forward slashes
    while properly encoding spaces and special characters.

    Args:
        path: File path (e.g., "workflows/Labo 2 - Test.json")

    Returns:
        URL-encoded path (e.g., "workflows/Labo%202%20-%20Test.json")
    """
    return "/".join(quote(segment, safe="") for segment in path.split("/"))


class GitHubAPIError(Exception):
    """GitHub API error with status code."""

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


class GitHubAPIService:
    """GitHub REST API wrapper with authentication."""

    def __init__(self, integration: GitHubIntegration):
        """
        Initialize the API service.

        Args:
            integration: The GitHub integration with access token
        """
        self.integration = integration
        self._access_token: str | None = None

    @property
    def access_token(self) -> str:
        """Decrypt and cache the access token."""
        if self._access_token is None:
            self._access_token = decrypt_secret(self.integration.access_token_encrypted)
            if not self._access_token:
                raise GitHubAPIError("Failed to decrypt access token")
        return self._access_token

    def _headers(self) -> dict[str, str]:
        """Get request headers with authentication."""
        return {
            "Authorization": f"Bearer {self.access_token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
        }

    async def _request(
        self,
        method: str,
        endpoint: str,
        **kwargs: Any,
    ) -> Any:
        """
        Make an authenticated request to the GitHub API.

        Args:
            method: HTTP method
            endpoint: API endpoint (without base URL)
            **kwargs: Additional arguments for httpx

        Returns:
            JSON response data

        Raises:
            GitHubAPIError: If the request fails
        """
        url = f"{GITHUB_API_URL}{endpoint}"
        headers = self._headers()
        if "headers" in kwargs:
            headers.update(kwargs.pop("headers"))

        async with httpx.AsyncClient() as client:
            try:
                response = await client.request(
                    method,
                    url,
                    headers=headers,
                    timeout=30.0,
                    **kwargs,
                )
                response.raise_for_status()

                if response.status_code == 204:
                    return None

                return response.json()

            except httpx.HTTPStatusError as e:
                error_body = {}
                try:
                    error_body = e.response.json()
                except Exception:
                    pass
                message = error_body.get("message", str(e))
                logger.error(f"GitHub API error: {e.response.status_code} - {message}")
                raise GitHubAPIError(message, e.response.status_code) from e
            except httpx.RequestError as e:
                logger.error(f"GitHub API request failed: {e}")
                raise GitHubAPIError(str(e)) from e

    async def get_user(self) -> dict[str, Any]:
        """Get the authenticated user's info."""
        return await self._request("GET", "/user")

    async def list_repos(
        self,
        per_page: int = 100,
        page: int = 1,
        sort: str = "updated",
    ) -> list[dict[str, Any]]:
        """
        List repositories the user has access to.

        Args:
            per_page: Number of repos per page (max 100)
            page: Page number
            sort: Sort order (created, updated, pushed, full_name)

        Returns:
            List of repository objects
        """
        return await self._request(
            "GET",
            "/user/repos",
            params={
                "per_page": per_page,
                "page": page,
                "sort": sort,
                "affiliation": "owner,collaborator,organization_member",
            },
        )

    async def get_repo(self, repo_full_name: str) -> dict[str, Any]:
        """
        Get repository info.

        Args:
            repo_full_name: Repository full name (owner/repo)

        Returns:
            Repository object
        """
        return await self._request("GET", f"/repos/{repo_full_name}")

    async def get_repo_contents(
        self,
        repo_full_name: str,
        path: str = "",
        ref: str | None = None,
    ) -> list[dict[str, Any]] | dict[str, Any]:
        """
        Get repository contents at a path.

        Args:
            repo_full_name: Repository full name (owner/repo)
            path: Path in repository (empty for root)
            ref: Branch, tag, or commit SHA

        Returns:
            List of content objects (for directories) or single content object (for files)
        """
        params = {}
        if ref:
            params["ref"] = ref

        return await self._request(
            "GET",
            f"/repos/{repo_full_name}/contents/{_encode_path(path)}",
            params=params if params else None,
        )

    async def get_file_content(
        self,
        repo_full_name: str,
        file_path: str,
        ref: str | None = None,
    ) -> tuple[str, str]:
        """
        Get file content and SHA.

        Args:
            repo_full_name: Repository full name (owner/repo)
            file_path: Path to file in repository
            ref: Branch, tag, or commit SHA

        Returns:
            Tuple of (content, sha)
        """
        params = {}
        if ref:
            params["ref"] = ref

        result = await self._request(
            "GET",
            f"/repos/{repo_full_name}/contents/{_encode_path(file_path)}",
            params=params if params else None,
        )

        if result.get("type") != "file":
            raise GitHubAPIError(f"Path {file_path} is not a file")

        content = result.get("content", "")
        # GitHub returns base64-encoded content
        decoded_content = base64.b64decode(content).decode("utf-8")
        sha = result.get("sha", "")

        return decoded_content, sha

    async def create_or_update_file(
        self,
        repo_full_name: str,
        file_path: str,
        content: str,
        message: str,
        sha: str | None = None,
        branch: str | None = None,
    ) -> dict[str, Any]:
        """
        Create or update a file in the repository.

        Args:
            repo_full_name: Repository full name (owner/repo)
            file_path: Path where to create/update the file
            content: File content (will be base64 encoded)
            message: Commit message
            sha: File SHA (required for updates)
            branch: Target branch

        Returns:
            API response with commit info
        """
        # Encode content to base64
        encoded_content = base64.b64encode(content.encode("utf-8")).decode("utf-8")

        data: dict[str, Any] = {
            "message": message,
            "content": encoded_content,
        }

        if sha:
            data["sha"] = sha
        if branch:
            data["branch"] = branch

        return await self._request(
            "PUT",
            f"/repos/{repo_full_name}/contents/{_encode_path(file_path)}",
            json=data,
        )

    async def delete_file(
        self,
        repo_full_name: str,
        file_path: str,
        sha: str,
        message: str,
        branch: str | None = None,
    ) -> dict[str, Any]:
        """
        Delete a file from the repository.

        Args:
            repo_full_name: Repository full name (owner/repo)
            file_path: Path to the file
            sha: File SHA
            message: Commit message
            branch: Target branch

        Returns:
            API response with commit info
        """
        data: dict[str, Any] = {
            "message": message,
            "sha": sha,
        }

        if branch:
            data["branch"] = branch

        return await self._request(
            "DELETE",
            f"/repos/{repo_full_name}/contents/{_encode_path(file_path)}",
            json=data,
        )

    async def get_tree(
        self,
        repo_full_name: str,
        tree_sha: str,
        recursive: bool = True,
    ) -> dict[str, Any]:
        """
        Get a tree (directory structure).

        Args:
            repo_full_name: Repository full name (owner/repo)
            tree_sha: SHA of the tree (or branch name)
            recursive: Whether to get recursive tree

        Returns:
            Tree object with file listing
        """
        params = {}
        if recursive:
            params["recursive"] = "1"

        return await self._request(
            "GET",
            f"/repos/{repo_full_name}/git/trees/{tree_sha}",
            params=params if params else None,
        )

    async def scan_files_matching_pattern(
        self,
        repo_full_name: str,
        branch: str,
        pattern: str,
    ) -> list[dict[str, Any]]:
        """
        Scan repository for files matching a glob pattern.

        Args:
            repo_full_name: Repository full name (owner/repo)
            branch: Branch name
            pattern: Glob pattern (e.g., "workflows/*.json")

        Returns:
            List of matching file objects with path, sha, size
        """
        # Get the full tree recursively
        tree = await self.get_tree(repo_full_name, branch, recursive=True)

        matching_files = []
        for item in tree.get("tree", []):
            if item.get("type") != "blob":
                continue

            file_path = item.get("path", "")

            # Check if file matches pattern
            if fnmatch.fnmatch(file_path, pattern):
                matching_files.append({
                    "path": file_path,
                    "sha": item.get("sha"),
                    "size": item.get("size", 0),
                })

        logger.info(
            f"Found {len(matching_files)} files matching '{pattern}' "
            f"in {repo_full_name}@{branch}"
        )

        return matching_files

    async def create_webhook(
        self,
        repo_full_name: str,
        webhook_url: str,
        secret: str | None = None,
        events: list[str] | None = None,
    ) -> tuple[dict[str, Any], str]:
        """
        Create a repository webhook.

        Args:
            repo_full_name: Repository full name (owner/repo)
            webhook_url: URL to receive webhook events
            secret: Webhook secret (generated if not provided)
            events: List of events to trigger webhook (default: ["push"])

        Returns:
            Tuple of (webhook response, secret)
        """
        if secret is None:
            secret = secrets.token_hex(32)

        if events is None:
            events = ["push"]

        data = {
            "name": "web",
            "active": True,
            "events": events,
            "config": {
                "url": webhook_url,
                "content_type": "json",
                "secret": secret,
                "insecure_ssl": "0",
            },
        }

        result = await self._request(
            "POST",
            f"/repos/{repo_full_name}/hooks",
            json=data,
        )

        logger.info(f"Created webhook {result.get('id')} for {repo_full_name}")

        return result, secret

    async def delete_webhook(
        self,
        repo_full_name: str,
        webhook_id: int,
    ) -> None:
        """
        Delete a repository webhook.

        Args:
            repo_full_name: Repository full name (owner/repo)
            webhook_id: Webhook ID
        """
        await self._request(
            "DELETE",
            f"/repos/{repo_full_name}/hooks/{webhook_id}",
        )

        logger.info(f"Deleted webhook {webhook_id} from {repo_full_name}")

    async def test_webhook(
        self,
        repo_full_name: str,
        webhook_id: int,
    ) -> None:
        """
        Trigger a test ping event for a webhook.

        Args:
            repo_full_name: Repository full name (owner/repo)
            webhook_id: Webhook ID
        """
        await self._request(
            "POST",
            f"/repos/{repo_full_name}/hooks/{webhook_id}/tests",
        )

        logger.info(f"Triggered test for webhook {webhook_id} in {repo_full_name}")

    async def get_branch(
        self,
        repo_full_name: str,
        branch: str,
    ) -> dict[str, Any]:
        """
        Get branch info.

        Args:
            repo_full_name: Repository full name (owner/repo)
            branch: Branch name

        Returns:
            Branch object
        """
        return await self._request(
            "GET",
            f"/repos/{repo_full_name}/branches/{branch}",
        )

    async def list_branches(
        self,
        repo_full_name: str,
        per_page: int = 100,
    ) -> list[dict[str, Any]]:
        """
        List repository branches.

        Args:
            repo_full_name: Repository full name (owner/repo)
            per_page: Number of branches per page

        Returns:
            List of branch objects
        """
        return await self._request(
            "GET",
            f"/repos/{repo_full_name}/branches",
            params={"per_page": per_page},
        )
