import pytest
import asyncio
from unittest.mock import MagicMock, AsyncMock
from datetime import datetime
from chatkit.types import ThreadMetadata, ActiveStatus, ThreadItemAddedEvent, UserMessageItem, UserMessageTextContent, InferenceOptions
# Adjust import based on where StreamProcessor is
from chatkit_server.server import StreamProcessor

@pytest.mark.asyncio
async def test_stream_processor_persistence():
    # Setup
    thread = ThreadMetadata(id="thread-1", created_at=datetime.now(), status=ActiveStatus())
    store = MagicMock()
    store.add_thread_item = AsyncMock()
    store.save_item = AsyncMock()

    processor = StreamProcessor(thread, store)
    context = MagicMock()
    processor.update_context(context)

    # Start loop (mock task)
    task = asyncio.create_task(asyncio.sleep(0.1))
    processor.start(task)

    # Send Added event
    item = UserMessageItem(
        id="msg-1",
        thread_id="thread-1",
        created_at=datetime.now(),
        content=[UserMessageTextContent(text="Hello")],
        attachments=[],
        inference_options=InferenceOptions()
    )
    event = ThreadItemAddedEvent(item=item)
    await processor.event_queue.put(event)

    # Wait a bit for the loop to process
    await asyncio.sleep(0.1)

    # Verify persistence - this proves persistence happens even without listeners!
    store.add_thread_item.assert_called()
    call_args = store.add_thread_item.call_args
    assert call_args[0][0] == "thread-1"
    assert call_args[0][1].id == "msg-1"

    # Cleanup
    if processor._task:
        processor._task.cancel()
        try:
            await processor._task
        except asyncio.CancelledError:
            pass
    task.cancel()
