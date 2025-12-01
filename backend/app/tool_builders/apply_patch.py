"""Construction de l'outil ApplyPatch pour les agents."""

from __future__ import annotations

import logging
from typing import Any, Mapping

from agents import ApplyPatchTool, Editor, apply_diff
from agents.tool import ApplyPatchOperation

from ..computer.hosted_ssh import HostedSSH

logger = logging.getLogger("chatkit.server")

__all__ = ["build_apply_patch_tool", "SSHEditor"]


class SSHEditor(Editor):
    """Editor implementation for SSH environments.

    This editor executes file operations via SSH using the HostedSSH connection.
    It uses apply_diff from the agents SDK to process diffs into file content.
    """

    def __init__(self, ssh: HostedSSH):
        """Initialize the SSH editor with a HostedSSH connection.

        Args:
            ssh: The HostedSSH instance to use for file operations.
        """
        self.ssh = ssh

    async def create_file(self, operation: ApplyPatchOperation) -> dict[str, Any]:
        """Create a new file at the specified path.

        Args:
            operation: The apply_patch operation containing path and diff.

        Returns:
            Result dict with status and output message.
        """
        try:
            # Convert diff to file content using apply_diff
            content = apply_diff("", operation.diff, create=True)

            # Escape single quotes in content for shell command
            escaped_content = content.replace("'", "'\"'\"'")

            # Use echo with heredoc to create file via SSH
            # We use base64 encoding to safely transfer content that may contain special characters
            import base64
            encoded_content = base64.b64encode(content.encode('utf-8')).decode('ascii')

            command = f"echo '{encoded_content}' | base64 -d > '{operation.path}'"
            await self.ssh.run_command(command)

            logger.info(f"Created file via SSH: {operation.path}")
            return {
                "status": "completed",
                "output": f"Created {operation.path}",
            }
        except Exception as exc:
            logger.exception(f"Failed to create file {operation.path} via SSH", exc_info=exc)
            return {
                "status": "failed",
                "output": f"Error creating {operation.path}: {str(exc)}",
            }

    async def update_file(self, operation: ApplyPatchOperation) -> dict[str, Any]:
        """Update an existing file at the specified path.

        Args:
            operation: The apply_patch operation containing path and diff.

        Returns:
            Result dict with status and output message.
        """
        try:
            # Read current file content via SSH
            read_command = f"cat '{operation.path}' 2>/dev/null || echo ''"
            current_content = await self.ssh.run_command(read_command)

            # Apply diff to get new content
            new_content = apply_diff(current_content, operation.diff)

            # Write updated content back via SSH using base64 encoding
            import base64
            encoded_content = base64.b64encode(new_content.encode('utf-8')).decode('ascii')

            write_command = f"echo '{encoded_content}' | base64 -d > '{operation.path}'"
            await self.ssh.run_command(write_command)

            logger.info(f"Updated file via SSH: {operation.path}")
            return {
                "status": "completed",
                "output": f"Updated {operation.path}",
            }
        except Exception as exc:
            logger.exception(f"Failed to update file {operation.path} via SSH", exc_info=exc)
            return {
                "status": "failed",
                "output": f"Error updating {operation.path}: {str(exc)}",
            }

    async def delete_file(self, operation: ApplyPatchOperation) -> dict[str, Any]:
        """Delete a file at the specified path.

        Args:
            operation: The apply_patch operation containing path.

        Returns:
            Result dict with status and output message.
        """
        try:
            # Delete file via SSH
            command = f"rm -f '{operation.path}'"
            await self.ssh.run_command(command)

            logger.info(f"Deleted file via SSH: {operation.path}")
            return {
                "status": "completed",
                "output": f"Deleted {operation.path}",
            }
        except Exception as exc:
            logger.exception(f"Failed to delete file {operation.path} via SSH", exc_info=exc)
            return {
                "status": "failed",
                "output": f"Error deleting {operation.path}: {str(exc)}",
            }


def build_apply_patch_tool(payload: Any) -> ApplyPatchTool | None:
    """Build an ApplyPatchTool for SSH environments.

    This tool enables agents to create, update, and delete files using structured
    diffs. It's designed to work with SSH environments where the agent has shell access.

    Args:
        payload: Configuration payload that should contain an ssh parameter with
                the HostedSSH instance to use for file operations.

    Returns:
        ApplyPatchTool configured with SSHEditor, or None if configuration is invalid.
    """
    if not isinstance(payload, Mapping):
        return None

    # Extract SSH connection from payload
    ssh = payload.get("ssh")
    if not isinstance(ssh, HostedSSH):
        logger.debug("No valid SSH connection provided for apply_patch tool")
        return None

    # Create editor with SSH connection
    editor = SSHEditor(ssh)

    # Create and return ApplyPatchTool
    # Set needs_approval=False since we trust the agent's decisions
    # You can change this to True and implement on_approval callback if needed
    logger.info("Creating ApplyPatchTool for SSH environment")
    return ApplyPatchTool(
        editor=editor,
        needs_approval=False,
    )
