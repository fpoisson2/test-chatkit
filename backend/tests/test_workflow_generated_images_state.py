# ruff: noqa: E402

import sys
from pathlib import Path
from types import SimpleNamespace

backend_dir = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(backend_dir))

import pytest
from app.image_utils import (
    append_generated_image_links,
    format_generated_image_links,
    merge_generated_image_urls_into_payload,
)
from app.workflows.runtime.steps import process_agent_step


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"


class DummyAgentContext:
    def __init__(self) -> None:
        self.thread = SimpleNamespace(id="thread-id")

    def generate_id(self, prefix: str) -> str:
        return f"{prefix}-generated"


class DummyResult:
    def __init__(self, final_output: str) -> None:
        self.final_output = final_output


@pytest.mark.anyio("asyncio")
async def test_process_agent_step_updates_last_generated_image_urls() -> None:
    generated_urls = ["https://example.test/image-1.png"]
    conversation_history: list = []
    state: dict = {}

    async def run_agent_step(*_: object, **__: object) -> DummyResult:
        return DummyResult("final output")

    def consume_generated_image_urls(step_key: str) -> list[str]:
        assert step_key == "agent_1"
        return generated_urls

    def structured_output_as_json(payload: str) -> tuple[dict[str, str], str]:
        return {"structured": payload}, payload

    async def record_step(*_: object) -> None:
        return None

    async def ingest_vector_store_step(*_: object, **__: object) -> None:
        return None

    async def stream_widget(*_: object, **__: object):  # type: ignore[no-untyped-def]
        return None

    current_node = SimpleNamespace(
        agent_key="agent", slug="step", parameters={}, kind="agent"
    )

    result = await process_agent_step(
        current_node=current_node,
        current_slug="step",
        agent_instances={"step": object()},
        agent_positions={},
        total_runtime_steps=1,
        widget_configs_by_step={},
        conversation_history=conversation_history,
        last_step_context=None,
        state=state,
        agent_context=DummyAgentContext(),
        run_agent_step=run_agent_step,
        consume_generated_image_urls=consume_generated_image_urls,
        structured_output_as_json=structured_output_as_json,
        record_step=record_step,
        merge_generated_image_urls_into_payload=merge_generated_image_urls_into_payload,
        append_generated_image_links=append_generated_image_links,
        format_generated_image_links=format_generated_image_links,
        ingest_vector_store_step=ingest_vector_store_step,
        stream_widget=stream_widget,
        should_wait_for_widget_action=lambda *_: False,
        on_widget_step=None,
        emit_stream_event=None,
        on_stream_event=None,
        branch_prefixed_slug=lambda slug: slug,
        node_title=lambda _: "title",
        next_edge=lambda _: None,
        session_factory=None,
    )

    assert state["last_generated_image_urls"] == generated_urls
    assert result.last_step_context["generated_image_urls"] == generated_urls
