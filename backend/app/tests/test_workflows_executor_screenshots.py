from datetime import datetime

import pytest

from openai.types.responses.response_computer_tool_call_output_item import (
    ResponseComputerToolCallOutputItem,
)
from openai.types.responses.response_computer_tool_call_output_screenshot import (
    ResponseComputerToolCallOutputScreenshot,
)

from backend.app.workflows import executor


def test_iter_computer_screenshots_detects_items():
    data_url = "data:image/png;base64,QUJD"
    raw_item = ResponseComputerToolCallOutputItem(
        id="out_1",
        call_id="call_1",
        output=ResponseComputerToolCallOutputScreenshot(
            type="computer_screenshot",
            image_url=data_url,
            file_id=None,
        ),
        type="computer_call_output",
    )
    tool_item = executor.ToolCallOutputItem(
        agent=object(),
        raw_item=raw_item,
        output=data_url,
    )

    collected = list(executor._iter_computer_screenshots([tool_item]))

    assert collected == [(tool_item, data_url)]


@pytest.mark.asyncio
async def test_broadcast_computer_screenshots_emits_events(monkeypatch):
    data_url = (
        "data:image/png;base64,"
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAAWgmWQ0AAAAASUVORK5CYII="
    )
    raw_item = ResponseComputerToolCallOutputItem(
        id="out_2",
        call_id="call_2",
        output=ResponseComputerToolCallOutputScreenshot(
            type="computer_screenshot",
            image_url=data_url,
            file_id=None,
        ),
        type="computer_call_output",
    )
    tool_item = executor.ToolCallOutputItem(
        agent=object(),
        raw_item=raw_item,
        output=data_url,
    )

    saved_payloads: list[tuple[str, str, str | None]] = []

    def fake_save(doc_id: str, b64_data: str, *, output_format: str | None = None):
        saved_payloads.append((doc_id, b64_data, output_format))
        return ("/tmp/out_2.png", "/api/chatkit/images/out_2.png")

    monkeypatch.setattr(executor, "save_agent_image_file", fake_save)

    events = []

    async def capture_event(event):
        events.append(event)

    class _StubContext:
        def __init__(self) -> None:
            self.thread = executor.ThreadMetadata(
                id="thread-1",
                created_at=datetime.now(),
                status=executor.ActiveStatus(),
                metadata={},
            )
            self._counter = 0

        def generate_id(self, item_type: str, thread=None):
            self._counter += 1
            return f"{item_type}-{self._counter}"

    history: list[object] = []

    urls = await executor._broadcast_computer_screenshots(
        [tool_item],
        agent_context=_StubContext(),
        metadata_for_images={"backend_public_base_url": "https://demo.test"},
        on_stream_event=capture_event,
        conversation_history=history,
    )

    assert saved_payloads
    assert saved_payloads[0][0] == "out_2"
    assert history and "![Capture d'écran](https://demo.test/api/chatkit/images/out_2.png)" in history[0]["content"][0]["text"]
    assert len(events) == 2
    assert urls == ["https://demo.test/api/chatkit/images/out_2.png"]
