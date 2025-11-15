from __future__ import annotations

# ruff: noqa: E402
import os
import sys
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

import backend.app.tests.test_workflows_nested as _workflow_test_stubs  # noqa: F401
from backend.app.chatkit_server.ags import (
    NullAGSClient,
    process_workflow_end_state_ags,
)
from backend.app.workflows.executor import WorkflowEndState


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class _StubAGSClient(NullAGSClient):
    def __init__(self) -> None:
        self.ensure_calls: list[dict[str, object]] = []
        self.publish_calls: list[dict[str, object]] = []

    async def ensure_line_item(
        self,
        *,
        context,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
    ) -> str | None:
        self.ensure_calls.append(
            {
                "context": context,
                "variable_id": variable_id,
                "max_score": max_score,
                "comment": comment,
            }
        )
        return "line-item-1"

    async def publish_score(
        self,
        *,
        context,
        line_item_id: str,
        variable_id: str,
        score: float,
        max_score: float | None,
    ) -> None:
        self.publish_calls.append(
            {
                "context": context,
                "line_item_id": line_item_id,
                "variable_id": variable_id,
                "score": score,
                "max_score": max_score,
            }
        )


class _StubAGSClientNoLineItem(_StubAGSClient):
    async def ensure_line_item(
        self,
        *,
        context,
        variable_id: str,
        max_score: float | None,
        comment: str | None,
    ) -> str | None:
        await super().ensure_line_item(
            context=context,
            variable_id=variable_id,
            max_score=max_score,
            comment=comment,
        )
        return None


@pytest.mark.anyio("asyncio")
async def test_process_workflow_end_state_posts_grade() -> None:
    client = _StubAGSClient()
    end_state = WorkflowEndState(
        slug="end",
        status_type="closed",
        status_reason="done",
        message="Terminé",
        ags_variable_id="score-1",
        ags_score_value=18.0,
        ags_score_maximum=20.0,
        ags_comment="Excellent travail",
    )

    context = SimpleNamespace(user_id="user-42")

    await process_workflow_end_state_ags(
        client=client,
        end_state=end_state,
        context=context,
    )

    assert client.ensure_calls == [
        {
            "context": context,
            "variable_id": "score-1",
            "max_score": 20.0,
            "comment": "Excellent travail",
        }
    ]
    assert client.publish_calls == [
        {
            "context": context,
            "line_item_id": "line-item-1",
            "variable_id": "score-1",
            "score": 18.0,
            "max_score": 20.0,
        }
    ]


@pytest.mark.anyio("asyncio")
async def test_process_workflow_end_state_without_line_item_uses_variable_id() -> None:
    client = _StubAGSClientNoLineItem()
    end_state = WorkflowEndState(
        slug="end",
        status_type="closed",
        status_reason="done",
        message="Terminé",
        ags_variable_id="score-2",
        ags_score_value=12.5,
        ags_score_maximum=None,
        ags_comment=None,
    )

    context = SimpleNamespace(user_id="user-24")

    await process_workflow_end_state_ags(
        client=client,
        end_state=end_state,
        context=context,
    )

    assert client.publish_calls == [
        {
            "context": context,
            "line_item_id": "score-2",
            "variable_id": "score-2",
            "score": 12.5,
            "max_score": None,
        }
    ]


@pytest.mark.anyio("asyncio")
async def test_process_workflow_end_state_missing_data_skips_calls() -> None:
    client = _StubAGSClient()
    end_state = WorkflowEndState(
        slug="end",
        status_type="closed",
        status_reason="done",
        message="Terminé",
        ags_variable_id=None,
        ags_score_value=None,
        ags_score_maximum=None,
        ags_comment=None,
    )

    await process_workflow_end_state_ags(
        client=client,
        end_state=end_state,
        context=None,
    )

    assert client.ensure_calls == []
    assert client.publish_calls == []

