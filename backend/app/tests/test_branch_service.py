from __future__ import annotations

import datetime as dt

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from backend.app.models import Base, ChatThread, ChatThreadBranch, ChatThreadItem
from backend.app.services.branch_service import BranchService, MAIN_BRANCH_ID

_WAIT_STATE_METADATA_KEY = "workflow_wait_for_user_input"
_WAIT_STATE_BY_BRANCH_METADATA_KEY = "workflow_wait_for_user_input_by_branch"
_WAIT_STATE_INDEX_BY_BRANCH_METADATA_KEY = "workflow_wait_for_user_input_index_by_branch"


def _build_session_factory(tmp_path):
    engine = create_engine(
        f"sqlite:///{tmp_path / 'branch-service.db'}",
        future=True,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


def test_create_branch_uses_fork_item_branch_as_parent(tmp_path) -> None:
    factory = _build_session_factory(tmp_path)
    now = dt.datetime.now(dt.UTC)
    thread_id = "thr-test"
    owner_id = "user-1"
    branch_a = "branch_a"

    with factory() as session:
        session.add(
            ChatThread(
                id=thread_id,
                owner_id=owner_id,
                created_at=now,
                updated_at=now,
                payload={"metadata": {"current_branch_id": branch_a}},
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id=MAIN_BRANCH_ID,
                thread_id=thread_id,
                parent_branch_id=None,
                fork_point_item_id=None,
                is_default=True,
                created_at=now,
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id=branch_a,
                thread_id=thread_id,
                parent_branch_id=MAIN_BRANCH_ID,
                fork_point_item_id="m2",
                is_default=False,
                created_at=now,
            )
        )
        session.add(
            ChatThreadItem(
                id="m1",
                thread_id=thread_id,
                owner_id=owner_id,
                created_at=now,
                payload={"type": "user_message"},
            )
        )
        session.add(
            ChatThreadItem(
                id="m2",
                thread_id=thread_id,
                owner_id=owner_id,
                created_at=now + dt.timedelta(seconds=1),
                payload={"type": "assistant_message"},
            )
        )
        session.add(
            ChatThreadItem(
                id="b1",
                thread_id=thread_id,
                owner_id=owner_id,
                created_at=now + dt.timedelta(seconds=2),
                payload={"type": "user_message", "branch_id": branch_a},
            )
        )
        session.commit()

    service = BranchService(factory)
    result = service.create_branch(
        thread_id=thread_id,
        fork_after_item_id="m1",
        owner_id=owner_id,
        name="Fork from main",
    )

    assert result is not None
    assert result["parent_branch_id"] == MAIN_BRANCH_ID

    with factory() as session:
        created = session.query(ChatThreadBranch).filter(
            ChatThreadBranch.thread_id == thread_id,
            ChatThreadBranch.branch_id == result["branch_id"],
        ).one()
        assert created.parent_branch_id == MAIN_BRANCH_ID


def test_switch_branch_migrates_legacy_wait_state_to_current_branch(tmp_path) -> None:
    factory = _build_session_factory(tmp_path)
    now = dt.datetime.now(dt.UTC)
    thread_id = "thr-switch"
    owner_id = "user-1"
    legacy_state = {"slug": "exercise_3"}

    with factory() as session:
        session.add(
            ChatThread(
                id=thread_id,
                owner_id=owner_id,
                created_at=now,
                updated_at=now,
                payload={
                    "metadata": {
                        "current_branch_id": "branch_old",
                        _WAIT_STATE_METADATA_KEY: legacy_state,
                    }
                },
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id=MAIN_BRANCH_ID,
                thread_id=thread_id,
                parent_branch_id=None,
                fork_point_item_id=None,
                is_default=True,
                created_at=now,
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id="branch_old",
                thread_id=thread_id,
                parent_branch_id=MAIN_BRANCH_ID,
                fork_point_item_id=None,
                is_default=False,
                created_at=now,
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id="branch_new",
                thread_id=thread_id,
                parent_branch_id=MAIN_BRANCH_ID,
                fork_point_item_id=None,
                is_default=False,
                created_at=now,
            )
        )
        session.commit()

    service = BranchService(factory)
    result = service.switch_branch(thread_id, "branch_new", owner_id)
    assert result is not None

    with factory() as session:
        thread = session.execute(
            select(ChatThread).where(ChatThread.id == thread_id)
        ).scalar_one()
        metadata = dict((thread.payload or {}).get("metadata") or {})

    assert metadata.get("current_branch_id") == "branch_new"
    assert _WAIT_STATE_METADATA_KEY not in metadata
    by_branch = metadata.get(_WAIT_STATE_BY_BRANCH_METADATA_KEY) or {}
    assert by_branch.get("branch_old") == legacy_state


def test_create_branch_restores_wait_state_from_parent_index(tmp_path) -> None:
    factory = _build_session_factory(tmp_path)
    now = dt.datetime.now(dt.UTC)
    thread_id = "thr-index"
    owner_id = "user-1"
    parent_branch = "branch_parent"
    fork_after_item_id = "msg_wait_prompt"
    indexed_wait_state = {
        "slug": "wait-ex2",
        "input_item_id": "msg_prev_user",
        "next_step_slug": "agent-ex2",
        "anchor_item_id": fork_after_item_id,
    }

    with factory() as session:
        session.add(
            ChatThread(
                id=thread_id,
                owner_id=owner_id,
                created_at=now,
                updated_at=now,
                payload={
                    "metadata": {
                        "current_branch_id": parent_branch,
                        _WAIT_STATE_BY_BRANCH_METADATA_KEY: {
                            parent_branch: {"slug": "wait-ex3"}
                        },
                        _WAIT_STATE_INDEX_BY_BRANCH_METADATA_KEY: {
                            parent_branch: {fork_after_item_id: indexed_wait_state}
                        },
                    }
                },
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id=MAIN_BRANCH_ID,
                thread_id=thread_id,
                parent_branch_id=None,
                fork_point_item_id=None,
                is_default=True,
                created_at=now,
            )
        )
        session.add(
            ChatThreadBranch(
                branch_id=parent_branch,
                thread_id=thread_id,
                parent_branch_id=MAIN_BRANCH_ID,
                fork_point_item_id="root",
                is_default=False,
                created_at=now,
            )
        )
        session.add(
            ChatThreadItem(
                id=fork_after_item_id,
                thread_id=thread_id,
                owner_id=owner_id,
                created_at=now,
                payload={"type": "assistant_message", "branch_id": parent_branch},
            )
        )
        session.commit()

    service = BranchService(factory)
    result = service.create_branch(
        thread_id=thread_id,
        fork_after_item_id=fork_after_item_id,
        owner_id=owner_id,
        name="from indexed wait",
    )
    assert result is not None
    new_branch = result["branch_id"]

    with factory() as session:
        thread = session.execute(
            select(ChatThread).where(ChatThread.id == thread_id)
        ).scalar_one()
        metadata = dict((thread.payload or {}).get("metadata") or {})

    by_branch = metadata.get(_WAIT_STATE_BY_BRANCH_METADATA_KEY) or {}
    assert by_branch.get(new_branch) == indexed_wait_state
