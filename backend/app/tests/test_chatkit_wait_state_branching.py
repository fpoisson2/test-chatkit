from __future__ import annotations

from types import SimpleNamespace

from backend.app.chatkit_server.context import (
    _get_wait_state_metadata,
    _set_wait_state_metadata,
)


def test_wait_state_is_isolated_per_branch() -> None:
    thread = SimpleNamespace(metadata={"current_branch_id": "main"})

    _set_wait_state_metadata(thread, {"slug": "step_main"})
    assert _get_wait_state_metadata(thread) == {"slug": "step_main"}

    thread.metadata["current_branch_id"] = "branch_a"
    assert _get_wait_state_metadata(thread) is None

    _set_wait_state_metadata(thread, {"slug": "step_a"})
    assert _get_wait_state_metadata(thread) == {"slug": "step_a"}

    thread.metadata["current_branch_id"] = "main"
    assert _get_wait_state_metadata(thread) == {"slug": "step_main"}


def test_branch_aware_metadata_prevents_legacy_cross_branch_fallback() -> None:
    thread = SimpleNamespace(
        metadata={
            "current_branch_id": "branch_b",
            "workflow_wait_for_user_input": {"slug": "legacy_global"},
            "workflow_wait_for_user_input_by_branch": {
                "main": {"slug": "main_only"},
            },
        }
    )

    assert _get_wait_state_metadata(thread) is None


def test_wait_state_index_records_anchor_item_id() -> None:
    thread = SimpleNamespace(metadata={"current_branch_id": "main"})

    _set_wait_state_metadata(
        thread,
        {
            "slug": "wait-ex2",
            "input_item_id": "msg_user_prev",
            "anchor_item_id": "msg_wait_prompt",
        },
    )

    by_branch_index = thread.metadata.get("workflow_wait_for_user_input_index_by_branch")
    assert isinstance(by_branch_index, dict)
    main_index = by_branch_index.get("main")
    assert isinstance(main_index, dict)
    assert "msg_wait_prompt" in main_index
    assert "input:msg_user_prev" in main_index
