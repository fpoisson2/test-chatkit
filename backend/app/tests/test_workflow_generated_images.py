import os
import sys
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any

import pytest

ROOT_DIR = Path(__file__).resolve().parents[3]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

os.environ.setdefault("DATABASE_URL", "sqlite:///./chatkit-tests.db")
os.environ.setdefault("OPENAI_API_KEY", "sk-test")
os.environ.setdefault("AUTH_SECRET_KEY", "secret-key")

stub_runtime_agents = ModuleType("backend.app.workflows.runtime.agents")
stub_runtime_agents.AgentSetupResult = SimpleNamespace  # type: ignore[attr-defined]
stub_runtime_agents.build_edges_by_source = lambda *args, **kwargs: {}  # type: ignore[attr-defined]
def _prepare_agents_stub(*args: Any, **kwargs: Any) -> SimpleNamespace:
    return SimpleNamespace(
        agent_instances={},
        agent_positions={},
        agent_provider_bindings={},
        total_runtime_steps=0,
    )


stub_runtime_agents.prepare_agents = _prepare_agents_stub
sys.modules.setdefault(
    "backend.app.workflows.runtime.agents", stub_runtime_agents
)

async def _noop_voice_session(*args: Any, **kwargs: Any) -> None:
    return None

realtime_runner_stub = ModuleType("backend.app.realtime_runner")
realtime_runner_stub.close_voice_session = _noop_voice_session
realtime_runner_stub.open_voice_session = _noop_voice_session
sys.modules.setdefault("backend.app.realtime_runner", realtime_runner_stub)


@pytest.fixture
def anyio_backend() -> str:  # noqa: D401 - fixture name imposed by anyio
    """Force the anyio backend to asyncio for this module."""

    return "asyncio"

from backend.app.image_utils import (  # noqa: E402
    append_generated_image_links,
    format_generated_image_links,
    merge_generated_image_urls_into_payload,
)
from backend.app.workflows.runtime.steps import (  # noqa: E402
    process_agent_step,
)


class DummyResult:
    def __init__(self, final_output: Any) -> None:
        self.final_output = final_output


@pytest.mark.anyio("asyncio")
async def test_generated_image_urls_propagated_to_context_and_state() -> None:
    image_url = "https://example.com/image.png"

    current_step = SimpleNamespace(
        agent_key=None,
        slug="image_step",
        position=1,
        kind="agent",
        parameters={},
    )
    agent_instances = {"image_step": object()}

    async def run_agent_step(*_: Any, **__: Any) -> DummyResult:
        return DummyResult(final_output={"ok": True})

    recorded_steps: list[tuple[str, str, Any]] = []
    state: dict[str, Any] = {}

    async def record_step(step_identifier: str, title: str, payload: Any) -> None:
        recorded_steps.append((step_identifier, title, payload))

    async def ingest_vector_store_step_stub(*args: Any, **kwargs: Any) -> None:
        return None

    async def stream_widget_stub(*args: Any, **kwargs: Any) -> None:
        return None

    result = await process_agent_step(
        current_node=current_step,
        current_slug="image_step",
        agent_instances=agent_instances,
        agent_positions={"image_step": 1},
        total_runtime_steps=1,
        widget_configs_by_step={},
        conversation_history=[],
        last_step_context=None,
        state=state,
        agent_context=SimpleNamespace(),
        run_agent_step=run_agent_step,
        consume_generated_image_urls=lambda step_key: [image_url]
        if step_key == "image_step_1"
        else [],
        structured_output_as_json=lambda output: (output, "output"),
        record_step=record_step,
        merge_generated_image_urls_into_payload=merge_generated_image_urls_into_payload,
        append_generated_image_links=append_generated_image_links,
        format_generated_image_links=format_generated_image_links,
        ingest_vector_store_step=ingest_vector_store_step_stub,
        stream_widget=stream_widget_stub,
        should_wait_for_widget_action=lambda *args, **kwargs: False,
        on_widget_step=None,
        emit_stream_event=None,
        on_stream_event=None,
        branch_prefixed_slug=lambda slug: slug,
        node_title=lambda step: step.slug,
        next_edge=lambda current: None,
        session_factory=None,
    )

    assert result.last_step_context is not None
    assert result.last_step_context.get("generated_image_urls") == [image_url]
    assert state.get("last_generated_image_urls") == [image_url]

    assert recorded_steps
    _, _, recorded_payload = recorded_steps[0]
    assert recorded_payload.get("generated_image_urls") == [image_url]
