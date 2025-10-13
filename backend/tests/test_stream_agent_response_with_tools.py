import asyncio
import json
import os
import sys
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace

# S'assurer que le package "app" est importable depuis le dossier backend
PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.append(str(PROJECT_ROOT))

os.environ.setdefault("OPENAI_API_KEY", "test-key")
os.environ.setdefault("DATABASE_URL", "sqlite:///test.db")
os.environ.setdefault("AUTH_SECRET_KEY", "secret")

from agents import Agent, ModelSettings  # noqa: E402
from agents.items import ToolCallItem, ToolCallOutputItem  # noqa: E402
from agents.stream_events import RunItemStreamEvent  # noqa: E402
from chatkit.agents import AgentContext  # noqa: E402
from chatkit.types import (  # noqa: E402
    ClientToolCallItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadMetadata,
)

from app.chatkit import stream_agent_response_with_tools  # noqa: E402


class _DummyStore:
    def __init__(self) -> None:
        self._counter = 0

    def generate_item_id(self, item_type, thread, context) -> str:  # noqa: D401
        self._counter += 1
        return f"{item_type}_{self._counter}"

    def generate_thread_id(self, context) -> str:  # noqa: D401
        self._counter += 1
        return f"thread_{self._counter}"

    async def load_thread_items(self, thread_id, after, limit, order, context):  # noqa: D401
        return SimpleNamespace(data=[])

    async def add_thread_item(self, thread_id, item, context):  # noqa: D401
        return None


class _DummyRunResult:
    def __init__(self, events):
        self._events_sequence = list(events)
        self.new_items = []
        self.final_output = None

    async def stream_events(self):
        for item in self._events_sequence:
            yield item

    def final_output_as(self, _type):  # noqa: D401
        return self.final_output


def _build_run_events():
    agent = Agent(
        name="dummy",
        instructions="Test agent",
        model="gpt-4.1-mini",
        model_settings=ModelSettings(),
    )
    tool_call_raw = SimpleNamespace(
        arguments=json.dumps({"query": "collège"}),
        call_id="call_1",
        name="web_search",
        type="function_call",
        id="tool_call_1",
    )
    tool_call_item = ToolCallItem(agent=agent, raw_item=tool_call_raw)

    tool_output_raw = SimpleNamespace(
        call_id="call_1",
        output=json.dumps({"links": ["https://example.com"]}),
        type="function_call_output",
    )
    tool_output_item = ToolCallOutputItem(
        agent=agent,
        raw_item=tool_output_raw,
        output=json.loads(tool_output_raw.output),
    )

    return [
        RunItemStreamEvent(name="tool_called", item=tool_call_item),
        RunItemStreamEvent(name="tool_output", item=tool_output_item),
    ]


def test_stream_agent_response_with_tools_emits_client_tool_call():
    thread = ThreadMetadata(id="thread_1", created_at=datetime.now())
    context = AgentContext(thread=thread, store=_DummyStore(), request_context=None)

    result = _DummyRunResult(_build_run_events())

    async def _collect():
        items = []
        async for event in stream_agent_response_with_tools(context, result):
            items.append(event)
        return items

    events = asyncio.run(_collect())

    tool_added = next(e for e in events if isinstance(e, ThreadItemAddedEvent))
    tool_updated = next(
        e
        for e in events
        if isinstance(e, ThreadItemUpdated)
        and isinstance(e.update, dict)
        and e.update.get("type") == "client_tool_call.updated"
    )
    tool_done = next(e for e in events if isinstance(e, ThreadItemDoneEvent))

    assert isinstance(tool_added.item, ClientToolCallItem)
    assert tool_added.item.status == "pending"
    assert tool_added.item.name == "web_search"
    assert tool_added.item.arguments == {"query": "collège"}

    assert tool_updated.item_id == tool_added.item.id
    assert tool_updated.update.get("status") == "completed"
    assert tool_updated.update.get("output") == {"links": ["https://example.com"]}

    assert tool_done.item.id == tool_added.item.id
    assert tool_done.item.status == "completed"
    assert tool_done.item.output == {"links": ["https://example.com"]}
