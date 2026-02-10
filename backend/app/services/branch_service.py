"""Service for managing conversation branches.

This service handles creating, listing, and switching between conversation branches.
Branches allow users to edit a message and create an alternate conversation path
while preserving the original history.
"""

from __future__ import annotations

import datetime
import uuid
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.orm.attributes import flag_modified

from ..models import ChatThread, ChatThreadBranch, ChatThreadItem

if TYPE_CHECKING:
    from sqlalchemy.orm import sessionmaker


# Default branch ID for the main conversation
MAIN_BRANCH_ID = "main"
_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input"
_WAIT_STATE_BY_BRANCH_METADATA_KEY = "workflow_wait_for_user_input_by_branch"
_WAIT_STATE_INDEX_BY_BRANCH_METADATA_KEY = "workflow_wait_for_user_input_index_by_branch"


class BranchService:
    """Service for managing conversation branches."""

    def __init__(self, session_factory: "sessionmaker[Session]") -> None:
        self._session_factory = session_factory

    @staticmethod
    def _migrate_legacy_wait_state_for_current_branch(
        metadata: dict[str, Any],
    ) -> dict[str, Any]:
        """Move legacy global wait state to branch-aware metadata for current branch."""
        current_branch_id = metadata.get("current_branch_id")
        if not isinstance(current_branch_id, str) or not current_branch_id.strip():
            current_branch_id = MAIN_BRANCH_ID
        else:
            current_branch_id = current_branch_id.strip()

        legacy_wait_state = metadata.get(_WAIT_STATE_METADATA_KEY)
        if not isinstance(legacy_wait_state, Mapping):
            return metadata

        wait_states_by_branch_raw = metadata.get(_WAIT_STATE_BY_BRANCH_METADATA_KEY)
        wait_states_by_branch = (
            dict(wait_states_by_branch_raw)
            if isinstance(wait_states_by_branch_raw, Mapping)
            else {}
        )
        wait_states_by_branch[current_branch_id] = dict(legacy_wait_state)
        metadata[_WAIT_STATE_BY_BRANCH_METADATA_KEY] = wait_states_by_branch
        metadata.pop(_WAIT_STATE_METADATA_KEY, None)
        return metadata

    def _generate_branch_id(self) -> str:
        """Generate a unique branch ID."""
        return f"branch_{uuid.uuid4().hex[:12]}"

    def list_branches(
        self,
        thread_id: str,
        owner_id: str,
    ) -> list[dict[str, Any]]:
        """List all branches for a thread.

        Args:
            thread_id: The thread ID to list branches for.
            owner_id: The owner ID for authorization.

        Returns:
            List of branch dictionaries with branch metadata.
        """
        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return []

            # Get all branches for the thread
            stmt = (
                select(ChatThreadBranch)
                .where(ChatThreadBranch.thread_id == thread_id)
                .order_by(ChatThreadBranch.created_at.asc())
            )
            branches = session.execute(stmt).scalars().all()

            # If no branches exist, create a default "main" branch implicitly
            if not branches:
                return [
                    {
                        "branch_id": MAIN_BRANCH_ID,
                        "name": None,
                        "is_default": True,
                        "parent_branch_id": None,
                        "fork_point_item_id": None,
                        "created_at": thread.created_at.isoformat()
                        if thread.created_at
                        else None,
                    }
                ]

            return [
                {
                    "branch_id": b.branch_id,
                    "name": b.name,
                    "is_default": b.is_default,
                    "parent_branch_id": b.parent_branch_id,
                    "fork_point_item_id": b.fork_point_item_id,
                    "created_at": b.created_at.isoformat() if b.created_at else None,
                }
                for b in branches
            ]

    def get_current_branch_id(self, thread_id: str, owner_id: str) -> str:
        """Get the current active branch ID for a thread from its metadata.

        Args:
            thread_id: The thread ID.
            owner_id: The owner ID for authorization.

        Returns:
            The current branch ID, defaults to MAIN_BRANCH_ID if not set.
        """
        with self._session_factory() as session:
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return MAIN_BRANCH_ID

            payload = thread.payload or {}
            metadata = payload.get("metadata") or {}
            return metadata.get("current_branch_id") or MAIN_BRANCH_ID

    def switch_branch(
        self,
        thread_id: str,
        branch_id: str,
        owner_id: str,
    ) -> dict[str, Any] | None:
        """Switch to a different branch.

        Updates the thread metadata to point to the new active branch.

        Args:
            thread_id: The thread ID.
            branch_id: The branch ID to switch to.
            owner_id: The owner ID for authorization.

        Returns:
            Updated branch info or None if branch not found.
        """
        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return None

            # For "main" branch, it always exists implicitly
            if branch_id != MAIN_BRANCH_ID:
                # Verify the branch exists
                branch = session.execute(
                    select(ChatThreadBranch).where(
                        ChatThreadBranch.thread_id == thread_id,
                        ChatThreadBranch.branch_id == branch_id,
                    )
                ).scalar_one_or_none()

                if branch is None:
                    return None

            # Update thread metadata with current branch
            payload = dict(thread.payload or {})
            metadata = dict(payload.get("metadata") or {})
            metadata = self._migrate_legacy_wait_state_for_current_branch(metadata)
            metadata["current_branch_id"] = branch_id
            payload["metadata"] = metadata
            thread.payload = payload
            # Explicitly mark payload as modified for SQLAlchemy to detect JSONB changes
            flag_modified(thread, "payload")
            session.commit()

            return {"branch_id": branch_id, "thread_id": thread_id}

    def create_branch(
        self,
        thread_id: str,
        fork_after_item_id: str,
        owner_id: str,
        edited_item_id: str | None = None,
        name: str | None = None,
    ) -> dict[str, Any] | None:
        """Create a new branch from an existing conversation point.

        Args:
            thread_id: The thread ID to branch from.
            fork_after_item_id: The item ID after which to fork
                (new branch starts with a modified version of items after this point).
            edited_item_id: The edited item ID (if available).
            owner_id: The owner ID for authorization.
            name: Optional name for the branch.

        Returns:
            Created branch info or None if creation failed.
        """
        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return None

            # Verify the fork point item exists
            fork_item = session.execute(
                select(ChatThreadItem).where(
                    ChatThreadItem.id == fork_after_item_id,
                    ChatThreadItem.thread_id == thread_id,
                )
            ).scalar_one_or_none()

            if fork_item is None:
                return None

            # Determine the parent branch from the fork point item itself.
            # This avoids attaching a new branch to the currently active branch
            # when the user edits a message that belongs to an ancestor branch.
            fork_payload = fork_item.payload if isinstance(fork_item.payload, dict) else {}
            fork_item_branch_id = fork_payload.get("branch_id")
            if isinstance(fork_item_branch_id, str) and fork_item_branch_id.strip():
                parent_branch_id = fork_item_branch_id.strip()
            else:
                parent_branch_id = MAIN_BRANCH_ID

            # Ensure the main branch record exists
            main_branch = session.execute(
                select(ChatThreadBranch).where(
                    ChatThreadBranch.thread_id == thread_id,
                    ChatThreadBranch.branch_id == MAIN_BRANCH_ID,
                )
            ).scalar_one_or_none()

            if main_branch is None:
                # Create the main branch record
                main_branch = ChatThreadBranch(
                    branch_id=MAIN_BRANCH_ID,
                    thread_id=thread_id,
                    parent_branch_id=None,
                    fork_point_item_id=None,
                    name=None,
                    is_default=True,
                    created_at=thread.created_at or datetime.datetime.now(datetime.UTC),
                )
                session.add(main_branch)
                session.flush()

            # Generate a new branch ID
            new_branch_id = self._generate_branch_id()

            # Create the branch record
            branch = ChatThreadBranch(
                branch_id=new_branch_id,
                thread_id=thread_id,
                parent_branch_id=parent_branch_id,
                fork_point_item_id=fork_after_item_id,
                name=name,
                is_default=False,
                created_at=datetime.datetime.now(datetime.UTC),
            )
            session.add(branch)

            # Switch to the new branch
            payload = dict(thread.payload or {})
            metadata = dict(payload.get("metadata") or {})
            metadata = self._migrate_legacy_wait_state_for_current_branch(metadata)
            wait_states_raw = metadata.get(_WAIT_STATE_BY_BRANCH_METADATA_KEY)
            wait_states = dict(wait_states_raw) if isinstance(wait_states_raw, Mapping) else {}

            # Restore branch-specific wait state at the fork point when available.
            wait_index_raw = metadata.get(_WAIT_STATE_INDEX_BY_BRANCH_METADATA_KEY)
            wait_index = dict(wait_index_raw) if isinstance(wait_index_raw, Mapping) else {}
            parent_wait_index_raw = wait_index.get(parent_branch_id)
            parent_wait_index = (
                dict(parent_wait_index_raw)
                if isinstance(parent_wait_index_raw, Mapping)
                else {}
            )
            restored_wait_state: Mapping[str, Any] | None = None

            if isinstance(edited_item_id, str) and edited_item_id.strip():
                edited_item_id = edited_item_id.strip()
                restored_wait_state = parent_wait_index.get(edited_item_id)

            if not isinstance(restored_wait_state, Mapping):
                restored_wait_state = parent_wait_index.get(fork_after_item_id)

            if not isinstance(restored_wait_state, Mapping):
                # Fallback: reuse a sibling branch wait state from the same fork point.
                sibling_branches = session.execute(
                    select(ChatThreadBranch)
                    .where(
                        ChatThreadBranch.thread_id == thread_id,
                        ChatThreadBranch.parent_branch_id == parent_branch_id,
                        ChatThreadBranch.fork_point_item_id == fork_after_item_id,
                    )
                    .order_by(ChatThreadBranch.created_at.desc())
                ).scalars().all()
                for sibling in sibling_branches:
                    candidate = wait_states.get(sibling.branch_id)
                    if (
                        isinstance(candidate, Mapping)
                        and candidate.get("anchor_item_id") == fork_after_item_id
                    ):
                        restored_wait_state = candidate
                        break

            if isinstance(restored_wait_state, Mapping):
                restored_wait_state = dict(restored_wait_state)
                if isinstance(edited_item_id, str) and edited_item_id:
                    restored_wait_state["input_item_id"] = edited_item_id
                    restored_wait_state.setdefault("anchor_item_id", fork_after_item_id)

            if isinstance(restored_wait_state, Mapping):
                wait_states[new_branch_id] = dict(restored_wait_state)
            else:
                wait_states.pop(new_branch_id, None)
            if wait_states:
                metadata[_WAIT_STATE_BY_BRANCH_METADATA_KEY] = wait_states
            else:
                metadata.pop(_WAIT_STATE_BY_BRANCH_METADATA_KEY, None)

            metadata["current_branch_id"] = new_branch_id
            payload["metadata"] = metadata
            thread.payload = payload
            # Explicitly mark payload as modified for SQLAlchemy to detect JSONB changes
            flag_modified(thread, "payload")

            session.commit()

            return {
                "branch_id": new_branch_id,
                "thread_id": thread_id,
                "parent_branch_id": parent_branch_id,
                "fork_point_item_id": fork_after_item_id,
                "name": name,
                "is_default": False,
                "created_at": branch.created_at.isoformat(),
            }

    def get_branch_info(
        self,
        thread_id: str,
        branch_id: str,
        owner_id: str,
    ) -> dict[str, Any] | None:
        """Get info about a specific branch.

        Args:
            thread_id: The thread ID.
            branch_id: The branch ID.
            owner_id: The owner ID for authorization.

        Returns:
            Branch info dict or None if not found.
        """
        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return None

            # Main branch always exists implicitly
            if branch_id == MAIN_BRANCH_ID:
                branch = session.execute(
                    select(ChatThreadBranch).where(
                        ChatThreadBranch.thread_id == thread_id,
                        ChatThreadBranch.branch_id == MAIN_BRANCH_ID,
                    )
                ).scalar_one_or_none()

                if branch is None:
                    return {
                        "branch_id": MAIN_BRANCH_ID,
                        "name": None,
                        "is_default": True,
                        "parent_branch_id": None,
                        "fork_point_item_id": None,
                        "created_at": thread.created_at.isoformat()
                        if thread.created_at
                        else None,
                    }

            else:
                branch = session.execute(
                    select(ChatThreadBranch).where(
                        ChatThreadBranch.thread_id == thread_id,
                        ChatThreadBranch.branch_id == branch_id,
                    )
                ).scalar_one_or_none()

                if branch is None:
                    return None

            return {
                "branch_id": branch.branch_id,
                "name": branch.name,
                "is_default": branch.is_default,
                "parent_branch_id": branch.parent_branch_id,
                "fork_point_item_id": branch.fork_point_item_id,
                "created_at": branch.created_at.isoformat() if branch.created_at else None,
            }

    def can_create_branch(
        self,
        thread_id: str,
        owner_id: str,
        max_branches: int = 0,
    ) -> bool:
        """Check if a new branch can be created for a thread.

        Args:
            thread_id: The thread ID.
            owner_id: The owner ID for authorization.
            max_branches: Maximum allowed branches (0 = unlimited).

        Returns:
            True if a new branch can be created.
        """
        if max_branches <= 0:
            return True

        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return False

            # Count existing branches
            from sqlalchemy import func

            count = session.execute(
                select(func.count(ChatThreadBranch.id)).where(
                    ChatThreadBranch.thread_id == thread_id
                )
            ).scalar_one()

            # Add 1 for the implicit main branch if no records exist
            if count == 0:
                count = 1

            return count < max_branches

    def get_fork_point_chain(
        self,
        thread_id: str,
        branch_id: str,
        owner_id: str,
    ) -> list[dict[str, Any]]:
        """Get the chain of fork points from root to the given branch.

        This is used to determine which items are shared vs branch-specific.

        Args:
            thread_id: The thread ID.
            branch_id: The branch ID.
            owner_id: The owner ID for authorization.

        Returns:
            List of fork point info from root to the given branch.
        """
        chain: list[dict[str, Any]] = []

        with self._session_factory() as session:
            # Verify thread ownership
            thread = session.execute(
                select(ChatThread).where(
                    ChatThread.id == thread_id,
                    ChatThread.owner_id == owner_id,
                )
            ).scalar_one_or_none()

            if thread is None:
                return chain

            current_branch_id = branch_id

            while current_branch_id and current_branch_id != MAIN_BRANCH_ID:
                branch = session.execute(
                    select(ChatThreadBranch).where(
                        ChatThreadBranch.thread_id == thread_id,
                        ChatThreadBranch.branch_id == current_branch_id,
                    )
                ).scalar_one_or_none()

                if branch is None:
                    break

                chain.insert(
                    0,
                    {
                        "branch_id": branch.branch_id,
                        "parent_branch_id": branch.parent_branch_id,
                        "fork_point_item_id": branch.fork_point_item_id,
                    },
                )
                current_branch_id = branch.parent_branch_id

        return chain
