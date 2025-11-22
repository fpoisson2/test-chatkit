import asyncio
import inspect
import json
from collections.abc import AsyncIterator
from datetime import datetime
from types import SimpleNamespace
from typing import Any, cast
from unittest.mock import AsyncMock, Mock

import pytest
from agents import (
    Agent,
    GuardrailFunctionOutput,
    InputGuardrail,
    InputGuardrailResult,
    InputGuardrailTripwireTriggered,
    OutputGuardrail,
    OutputGuardrailResult,
    OutputGuardrailTripwireTriggered,
    RawResponsesStreamEvent,
    RunContextWrapper,
    RunItemStreamEvent,
    Runner,
    RunResultStreaming,
    StreamEvent,
    ToolCallItem,
    ToolCallOutputItem,
)
from agents._run_impl import QueueCompleteSentinel
from openai.types.responses import (
    EasyInputMessageParam,
    ResponseComputerToolCall,
    ResponseFileSearchToolCall,
    ResponseFunctionWebSearch,
    ResponseImageGenCallCompletedEvent,
    ResponseImageGenCallGeneratingEvent,
    ResponseImageGenCallInProgressEvent,
    ResponseImageGenCallPartialImageEvent,
    ResponseInputContentParam,
    ResponseInputTextParam,
    ResponseOutputItemAddedEvent,
    ResponseOutputItemDoneEvent,
    ResponseOutputMessage,
    ResponseReasoningItem,
)
from openai.types.responses.response_computer_tool_call import ActionClick
from openai.types.responses.response_content_part_added_event import (
    ResponseContentPartAddedEvent,
)
from openai.types.responses.response_file_search_tool_call import Result
from openai.types.responses.response_function_call_arguments_delta_event import (
    ResponseFunctionCallArgumentsDeltaEvent,
)
from openai.types.responses.response_function_call_arguments_done_event import (
    ResponseFunctionCallArgumentsDoneEvent,
)
from openai.types.responses.response_function_tool_call_item import (
    ResponseFunctionToolCallItem,
)
from openai.types.responses.response_function_web_search import (
    ActionSearch,
    ActionSearchSource,
)
from openai.types.responses.response_input_item_param import (
    ComputerCallOutput,
    FunctionCallOutput,
    ResponseComputerToolCallOutputScreenshotParam,
)
from openai.types.responses.response_output_item import ImageGenerationCall
from openai.types.responses.response_output_text import (
    AnnotationFileCitation as ResponsesAnnotationFileCitation,
)
from openai.types.responses.response_output_text import (
    AnnotationFilePath as ResponsesAnnotationFilePath,
)
from openai.types.responses.response_output_text import (
    AnnotationURLCitation as ResponsesAnnotationURLCitation,
)
from openai.types.responses.response_output_text import (
    ResponseOutputText,
)
from openai.types.responses.response_text_delta_event import ResponseTextDeltaEvent
from openai.types.responses.response_text_done_event import ResponseTextDoneEvent
from openai.types.responses.response_web_search_call_searching_event import (
    ResponseWebSearchCallSearchingEvent,
)

from chatkit.agents import (
    AgentContext,
    ThreadItemConverter,
    accumulate_text,
    simple_to_agent_input,
    stream_agent_response,
    set_current_computer_tool,
    set_debug_session_callback,
)
from chatkit.types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    Attachment,
    ClientToolCallItem,
    ComputerUseTask,
    CustomSummary,
    CustomTask,
    DurationSummary,
    FileSource,
    ImageTask,
    InferenceOptions,
    Page,
    SearchTask,
    TaskItem,
    ThoughtTask,
    Thread,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemUpdated,
    ThreadStreamEvent,
    URLSource,
    UserMessageItem,
    UserMessageTagContent,
    UserMessageTextContent,
    WidgetItem,
    Workflow,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)
from chatkit.widgets import Card, Text

thread = Thread(id="123", title="Test", created_at=datetime.now(), items=Page())

mock_store = Mock()
mock_store.generate_item_id = lambda item_type, thread, context: f"{item_type}_id"
mock_store.load_thread_items = AsyncMock(return_value=Page())
mock_store.add_thread_item = AsyncMock()


class RunResult(RunResultStreaming):
    def add_event(self, event: StreamEvent):
        self._event_queue.put_nowait(event)

    def done(self):
        self.is_complete = True
        self._event_queue.put_nowait(QueueCompleteSentinel())

    def throw_input_guardrails(self):
        self._stored_exception = InputGuardrailTripwireTriggered(
            InputGuardrailResult(
                guardrail=Mock(spec=InputGuardrail),
                output=GuardrailFunctionOutput(
                    output_info=None,
                    tripwire_triggered=True,
                ),
            )
        )
        self.is_complete = True
        self._event_queue.put_nowait(QueueCompleteSentinel())

    def throw_output_guardrails(self):
        self._stored_exception = OutputGuardrailTripwireTriggered(
            OutputGuardrailResult(
                guardrail=Mock(spec=OutputGuardrail),
                output=GuardrailFunctionOutput(
                    output_info=None,
                    tripwire_triggered=True,
                ),
                agent=Mock(spec=Agent),
                agent_output=None,
            )
        )
        self.is_complete = True
        self._event_queue.put_nowait(QueueCompleteSentinel())


def make_result() -> RunResult:
    kwargs = {
        "context_wrapper": Mock(spec=RunContextWrapper),
        "input": [],
        "new_items": [],
        "raw_responses": [],
        "final_output": None,
        "input_guardrail_results": [],
        "output_guardrail_results": [],
        "tool_input_guardrail_results": [],
        "tool_output_guardrail_results": [],
        "current_agent": Agent(name="test"),
        "current_turn": 0,
        "max_turns": 10,
        "_current_agent_output_schema": None,
        "trace": None,
        "is_complete": False,
        "_event_queue": asyncio.Queue(),
        "_input_guardrail_queue": asyncio.Queue(),
        "_run_impl_task": None,
        "_input_guardrails_task": None,
        "_output_guardrails_task": None,
        "_stored_exception": None,
    }
    signature = inspect.signature(RunResultStreaming.__init__)
    accepted = {name for name in signature.parameters if name != "self"}
    filtered_kwargs = {key: value for key, value in kwargs.items() if key in accepted}
    return RunResult(**filtered_kwargs)


async def all_events(
    events: AsyncIterator[ThreadStreamEvent],
) -> list[ThreadStreamEvent]:
    return [event async for event in events]


async def test_returns_widget_item():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()
    result.add_event(
        RunItemStreamEvent(name="tool_called", item=Mock(spec=ToolCallItem))
    )
    await context.stream_widget(Card(children=[Text(value="Hello, world!")]))
    result.done()

    events = await all_events(
        stream_agent_response(
            context=context,
            result=result,
        )
    )

    assert len(events) == 1
    assert isinstance(events[0], ThreadItemDoneEvent)
    assert isinstance(events[0].item, WidgetItem)
    assert events[0].item.widget == Card(children=[Text(value="Hello, world!")])


async def test_returns_widget_item_generator():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()
    result.add_event(
        RunItemStreamEvent(name="tool_called", item=Mock(spec=ToolCallItem))
    )

    def render_widget(i: int) -> Card:
        return Card(children=[Text(id="text", value="Hello, world"[:i])])

    async def widget_generator():
        yield render_widget(0)
        yield render_widget(12)

    await context.stream_widget(widget_generator())
    result.done()

    events = await all_events(
        stream_agent_response(
            context=context,
            result=result,
        )
    )

    assert len(events) == 3
    assert isinstance(events[0], ThreadItemAddedEvent)
    assert isinstance(events[0].item, WidgetItem)
    assert events[0].item.widget == Card(children=[Text(id="text", value="")])

    assert isinstance(events[1], ThreadItemUpdated)
    assert events[1].update.type == "widget.streaming_text.value_delta"
    assert events[1].update.component_id == "text"
    assert events[1].update.delta == "Hello, world"

    assert isinstance(events[2], ThreadItemDoneEvent)
    assert isinstance(events[2].item, WidgetItem)
    assert events[2].item.widget == Card(
        children=[Text(id="text", value="Hello, world")]
    )


async def test_returns_widget_full_replace_generator():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()
    result.add_event(
        RunItemStreamEvent(name="tool_called", item=Mock(spec=ToolCallItem))
    )

    async def widget_generator():
        yield Card(children=[Text(id="text", value="Hello!")])
        yield Card(children=[Text(key="other text", value="World!", streaming=False)])

    await context.stream_widget(widget_generator())
    result.done()

    events = await all_events(
        stream_agent_response(
            context=context,
            result=result,
        )
    )

    assert len(events) == 3
    assert isinstance(events[0], ThreadItemAddedEvent)
    assert isinstance(events[0].item, WidgetItem)
    assert events[0].item.widget == Card(children=[Text(id="text", value="Hello!")])

    assert isinstance(events[1], ThreadItemUpdated)
    assert events[1].update.type == "widget.root.updated"
    assert events[1].update.widget == Card(
        children=[Text(key="other text", value="World!", streaming=False)]
    )

    assert isinstance(events[2], ThreadItemDoneEvent)
    assert isinstance(events[2].item, WidgetItem)
    assert events[2].item.widget == Card(
        children=[Text(key="other text", value="World!", streaming=False)]
    )


async def test_accumulate_text():
    def delta(text: str) -> RawResponsesStreamEvent:
        return RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseTextDeltaEvent(
                type="response.output_text.delta",
                delta=text,
                content_index=0,
                item_id="123",
                logprobs=[],
                output_index=0,
                sequence_number=0,
            ),
        )

    result = Runner.run_streamed(
        Agent("Assistant", instructions="You are a helpful assistant."), "Say hello!"
    )
    result = make_result()
    result.add_event(delta("Hello, "))
    result.add_event(delta("world!"))

    result.done()

    events = [
        event
        async for event in accumulate_text(
            result.stream_events(), Text(key="text", value="", streaming=True)
        )
    ]
    assert events == [
        Text(key="text", value="", streaming=True),
        Text(key="text", value="Hello, ", streaming=True),
        Text(key="text", value="Hello, world!", streaming=True),
        Text(key="text", value="Hello, world!", streaming=False),
    ]


async def test_input_item_converter_quotes_last_user_message():
    items = [
        UserMessageItem(
            id="123",
            content=[UserMessageTextContent(text="Hello!")],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            quoted_text="Hi!",
            created_at=datetime.now(),
        ),
        UserMessageItem(
            id="123",
            content=[UserMessageTextContent(text="I'm well, thank you!")],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            quoted_text="How are you doing?",
            created_at=datetime.now(),
        ),
    ]

    async def throw_exception(
        _: Attachment,
    ) -> ResponseInputContentParam:
        raise Exception("Not implemented")

    input_items = await simple_to_agent_input(items)
    assert len(input_items) == 3
    assert input_items[0] == {
        "content": [
            {
                "text": "Hello!",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert input_items[1] == {
        "content": [
            {
                "text": "I'm well, thank you!",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert input_items[2] == {
        "content": [
            {
                "text": "The user is referring to this in particular: \nHow are you doing?",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }


async def test_input_item_converter_to_input_items_mixed():
    items = [
        UserMessageItem(
            id="123",
            content=[UserMessageTextContent(text="Hello!")],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            quoted_text="Hi!",
            created_at=datetime.now(),
        ),
        UserMessageItem(
            id="123",
            content=[UserMessageTextContent(text="I'm well, thank you!")],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            quoted_text="How are you doing?",
            created_at=datetime.now(),
        ),
        AssistantMessageItem(
            id="123",
            content=[
                AssistantMessageContent(text="How are you doing?"),
                AssistantMessageContent(text="Can't do that"),
            ],
            thread_id=thread.id,
            created_at=datetime.now(),
        ),
        WidgetItem(
            id="wd_123",
            widget=Card(children=[Text(value="Hello, world!")]),
            thread_id=thread.id,
            created_at=datetime.now(),
        ),
    ]

    input_items = await simple_to_agent_input(items)
    assert len(input_items) == 4
    assert input_items[0] == {
        "content": [
            {
                "text": "Hello!",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert input_items[1] == {
        "content": [
            {
                "text": "I'm well, thank you!",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert input_items[2] == {
        "content": [
            {
                "annotations": [],
                "text": "How are you doing?",
                "logprobs": None,
                "type": "output_text",
            },
            {
                "annotations": [],
                "text": "Can't do that",
                "logprobs": None,
                "type": "output_text",
            },
        ],
        "type": "message",
        "role": "assistant",
    }
    assert "type" in input_items[3]
    widget_item = cast(EasyInputMessageParam, input_items[3])
    assert widget_item.get("type") == "message"
    assert widget_item.get("role") == "user"
    text = widget_item.get("content")[0]["text"]  # type: ignore
    assert (
        "The following graphical UI widget (id: wd_123) was displayed to the user"
        in text
    )
    assert "Hello, world!" in text
    assert "created_at" not in text


async def test_input_item_converter_user_input_with_tags():
    class MyThreadItemConverter(ThreadItemConverter):
        def tag_to_message_content(self, tag):
            return ResponseInputTextParam(
                type="input_text", text=tag.text + " " + tag.data["key"]
            )

    items = [
        UserMessageItem(
            id="123",
            content=[
                UserMessageTagContent(
                    text="Hello!", type="input_tag", id="hello", data={"key": "value"}
                )
            ],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            created_at=datetime.now(),
        )
    ]
    items = await MyThreadItemConverter().to_agent_input(items)

    assert len(items) == 2
    assert items[0] == {
        "content": [
            {
                "text": "@Hello!",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert items[1] == {
        "content": [
            {
                "text": "# User-provided context for @-mentions\n- When referencing resolved entities, use their canonical names **without** '@'.\n"
                + "- The '@' form appears only in user text and should not be echoed.",
                "type": "input_text",
            },
            {
                "text": "Hello! value",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }


async def test_input_item_converter_user_input_with_tags_throws_by_default():
    items = [
        UserMessageItem(
            id="123",
            content=[
                UserMessageTagContent(
                    text="Hello!", type="input_tag", id="hello", data={}
                )
            ],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            created_at=datetime.now(),
        )
    ]

    with pytest.raises(NotImplementedError):
        await simple_to_agent_input(items)


async def test_input_item_converter_with_client_tool_call():
    items = [
        UserMessageItem(
            id="123",
            content=[UserMessageTextContent(text="Call a client tool call xyz")],
            attachments=[],
            inference_options=InferenceOptions(),
            thread_id=thread.id,
            quoted_text="Hi!",
            created_at=datetime.now(),
        ),
        TaskItem(
            id="tsk_123",
            created_at=datetime.now(),
            task=CustomTask(title="Called xyx"),
            thread_id=thread.id,
        ),
        ClientToolCallItem(
            id="ctc_123",
            thread_id=thread.id,
            created_at=datetime.now(),
            name="xyz",
            arguments={"foo": "bar"},
            call_id="ctc_123",
        ),
        ClientToolCallItem(
            id="ctc_123_done",
            thread_id=thread.id,
            created_at=datetime.now(),
            name="xyz",
            arguments={"foo": "bar"},
            call_id="ctc_123",
            status="completed",
            output={"success": True},
        ),
    ]

    input_items = await simple_to_agent_input(items)
    assert len(input_items) == 4
    assert input_items[0] == {
        "content": [
            {
                "text": "Call a client tool call xyz",
                "type": "input_text",
            },
        ],
        "role": "user",
        "type": "message",
    }
    assert input_items[1] == {
        "content": [
            {
                "text": "A message was displayed to the user that the following task was performed:\n<Task>\nCalled xyx\n</Task>",
                "type": "input_text",
            },
        ],
        "type": "message",
        "role": "user",
    }
    assert input_items[2] == {
        "type": "function_call",
        "name": "xyz",
        "arguments": json.dumps({"foo": "bar"}),
        "call_id": "ctc_123",
    }
    assert input_items[3] == {
        "type": "function_call_output",
        "call_id": "ctc_123",
        "output": json.dumps({"success": True}),
    }


async def test_stream_agent_response_yields_context_events_without_streaming_events():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    event = ThreadItemAddedEvent(
        item=WidgetItem(
            id="123",
            created_at=datetime.now(),
            thread_id=thread.id,
            widget=Card(children=[Text(id="text", value="Hello, world!")]),
        ),
    )

    await context.stream(event)

    response_streamer = stream_agent_response(context, result)
    event = await response_streamer.__anext__()

    assert event.type == "thread.item.added"

    future = asyncio.ensure_future(response_streamer.__anext__())
    assert future.done() is False

    result.done()

    try:
        await future
        assert False, "expected StopAsyncIteration"
    except StopAsyncIteration:
        pass

    assert future.done() is True


async def test_stream_agent_response_maps_events():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    event = ThreadItemAddedEvent(
        item=WidgetItem(
            id="123",
            created_at=datetime.now(),
            thread_id=thread.id,
            widget=Card(children=[Text(id="text", value="Hello, world!")]),
        ),
    )

    await context.stream(event)
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseTextDeltaEvent(
                type="response.output_text.delta",
                delta="Hello, world!",
                content_index=0,
                item_id="123",
                logprobs=[],
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    response_streamer = stream_agent_response(context, result)
    event1 = await response_streamer.__anext__()
    event2 = await response_streamer.__anext__()

    assert {event1.type, event2.type} == {
        "thread.item.added",
        "thread.item.updated",
    }

    future = asyncio.ensure_future(response_streamer.__anext__())
    assert future.done() is False

    result.done()

    try:
        await future
        assert False, "expected StopAsyncIteration"
    except StopAsyncIteration:
        pass

    assert future.done() is True


@pytest.mark.parametrize(
    "raw_event,expected_event",
    [
        (
            RawResponsesStreamEvent(
                type="raw_response_event",
                data=ResponseTextDeltaEvent(
                    type="response.output_text.delta",
                    delta="Hello, world!",
                    content_index=0,
                    item_id="123",
                    logprobs=[],
                    output_index=0,
                    sequence_number=0,
                ),
            ),
            ThreadItemUpdated(
                item_id="123",
                update=AssistantMessageContentPartTextDelta(
                    content_index=0,
                    delta="Hello, world!",
                ),
            ),
        ),
        (
            RawResponsesStreamEvent(
                type="raw_response_event",
                data=ResponseContentPartAddedEvent(
                    type="response.content_part.added",
                    part=ResponseOutputText(
                        type="output_text",
                        text="New content",
                        annotations=[],
                    ),
                    content_index=1,
                    item_id="123",
                    output_index=0,
                    sequence_number=1,
                ),
            ),
            ThreadItemUpdated(
                item_id="123",
                update=AssistantMessageContentPartAdded(
                    content_index=1,
                    content=AssistantMessageContent(text="New content", annotations=[]),
                ),
            ),
        ),
        (
            RawResponsesStreamEvent(
                type="raw_response_event",
                data=ResponseTextDoneEvent(
                    type="response.output_text.done",
                    text="Final text",
                    content_index=0,
                    item_id="123",
                    logprobs=[],
                    output_index=0,
                    sequence_number=2,
                ),
            ),
            ThreadItemUpdated(
                item_id="123",
                update=AssistantMessageContentPartDone(
                    content_index=0,
                    content=AssistantMessageContent(
                        text="Final text",
                        annotations=[],
                    ),
                ),
            ),
        ),
        (
            RawResponsesStreamEvent(
                type="raw_response_event",
                data=Mock(
                    type="response.output_text.annotation.added",
                    annotation=ResponsesAnnotationFileCitation(
                        type="file_citation",
                        file_id="file_123",
                        filename="file.txt",
                        index=5,
                    ),
                    content_index=0,
                    item_id="123",
                    annotation_index=0,
                    output_index=0,
                    sequence_number=3,
                ),
            ),
            None,
        ),
    ],
)
async def test_event_mapping(raw_event, expected_event):
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    result.add_event(raw_event)
    result.done()

    events = await all_events(stream_agent_response(context, result))
    if expected_event:
        assert events == [expected_event]
    else:
        assert events == []


@pytest.mark.parametrize("throw_guardrail", ["input", "output"])
async def test_stream_agent_response_yields_item_removed_event(throw_guardrail):
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=ResponseOutputMessage(
                    id="1",
                    content=[
                        ResponseOutputText(
                            annotations=[], type="output_text", text="Hello, world!"
                        )
                    ],
                    role="assistant",
                    status="completed",
                    type="message",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    await context.stream(
        ThreadItemAddedEvent(
            item=AssistantMessageItem(
                id="2",
                content=[AssistantMessageContent(text="Hello, world!")],
                thread_id=thread.id,
                created_at=datetime.now(),
            ),
        )
    )

    await context.stream(
        ThreadItemDoneEvent(
            item=WidgetItem(
                id="3",
                created_at=datetime.now(),
                thread_id=thread.id,
                widget=Card(children=[Text(id="text", value="Hello, world!")]),
            ),
        )
    )

    iterator = stream_agent_response(context, result)

    n = 3
    events = []
    # Grab first 3 events to
    async for event in iterator:
        n -= 1
        events.append(event)
        if n == 0:
            break

    if throw_guardrail == "input":
        result.throw_input_guardrails()
    else:
        result.throw_output_guardrails()

    try:
        async for event in iterator:
            events.append(event)
        assert False, "Guardrail should have been thrown from stream_agent_response"
    except (InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered):
        pass
    except Exception as e:
        assert False, f"Unexpected exception: {e}"

    deleted_item_ids = {
        event.item_id for event in events if event.type == "thread.item.removed"
    }
    assert deleted_item_ids == {"1", "2", "3"}


async def test_stream_agent_response_assistant_message_content_types():
    AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=ResponseFileSearchToolCall(
                    id="fs_0",
                    queries=["Hello, world!"],
                    status="completed",
                    type="file_search_call",
                    results=[
                        Result(
                            file_id="f_123",
                            filename="test.txt",
                            text="Hello, world!",
                            score=1.0,
                        ),
                        Result(
                            file_id="f_123",
                            filename="test.txt",
                            text="Hello, friends!",
                            score=0.5,
                        ),
                    ],
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=ResponseOutputMessage(
                    id="1",
                    content=[
                        ResponseOutputText(
                            annotations=[
                                ResponsesAnnotationFileCitation(
                                    type="file_citation",
                                    file_id="f_123",
                                    index=0,
                                    filename="test.txt",
                                ),
                                ResponsesAnnotationURLCitation(
                                    type="url_citation",
                                    url="https://www.google.com",
                                    title="Google",
                                    start_index=0,
                                    end_index=10,
                                ),
                                ResponsesAnnotationFilePath(
                                    type="file_path",
                                    file_id="123",
                                    index=0,
                                ),
                            ],
                            text="Hello, world!",
                            type="output_text",
                        ),
                        ResponseOutputText(
                            annotations=[],
                            text="Can't do that",
                            type="output_text",
                        ),
                    ],
                    role="assistant",
                    status="completed",
                    type="message",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    result.done()

    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    events = await all_events(stream_agent_response(context, result))
    assert len(events) == 1
    assert isinstance(events[0], ThreadItemDoneEvent)
    message = events[0].item
    assert isinstance(message, AssistantMessageItem)
    assert message.content == [
        AssistantMessageContent(
            annotations=[
                Annotation(
                    source=FileSource(
                        filename="test.txt",
                        title="test.txt",
                    ),
                    index=0,
                ),
                Annotation(
                    source=URLSource(
                        url="https://www.google.com",
                        title="Google",
                    ),
                    index=10,
                ),
            ],
            text="Hello, world!",
        ),
        AssistantMessageContent(text="Can't do that", annotations=[]),
    ]
    assert message.id == "1"


async def test_workflow_streams_first_thought():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    # first thought
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=ResponseReasoningItem(
                    id="resp_1",
                    summary=[],
                    type="reasoning",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.delta",
                item_id="resp_1",
                summary_index=0,
                delta="Think",
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.delta",
                item_id="resp_1",
                summary_index=0,
                delta="ing 1",
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.done",
                item_id="resp_1",
                summary_index=0,
                text="Thinking 1",
            ),
        )
    )

    # second thought
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.delta",
                item_id="resp_1",
                summary_index=1,
                delta="Think",
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.delta",
                item_id="resp_1",
                summary_index=1,
                delta="ing 2",
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.done",
                item_id="resp_1",
                summary_index=1,
                text="Thinking 2",
            ),
        )
    )

    result.done()
    stream = stream_agent_response(context, result)

    # Workflow added
    event = await anext(stream)
    assert isinstance(event, ThreadItemAddedEvent)
    assert context.workflow_item is not None
    assert context.workflow_item.workflow.type == "reasoning"
    assert len(context.workflow_item.workflow.tasks) == 0
    assert event == ThreadItemAddedEvent(item=context.workflow_item)

    # First thought added
    event = await anext(stream)
    assert context.workflow_item is not None
    assert len(context.workflow_item.workflow.tasks) == 1
    assert isinstance(event, ThreadItemUpdated)
    assert event == ThreadItemUpdated(
        item_id=context.workflow_item.id,
        update=WorkflowTaskAdded(
            task=ThoughtTask(content="Think"),
            task_index=0,
        ),
    )

    # First thought delta
    event = await anext(stream)
    assert context.workflow_item is not None
    assert len(context.workflow_item.workflow.tasks) == 1
    assert isinstance(event, ThreadItemUpdated)
    assert event == ThreadItemUpdated(
        item_id=context.workflow_item.id,
        update=WorkflowTaskUpdated(
            task=ThoughtTask(content="Thinking 1"),
            task_index=0,
        ),
    )

    # First thought done
    event = await anext(stream)
    assert context.workflow_item is not None
    assert len(context.workflow_item.workflow.tasks) == 1
    assert isinstance(event, ThreadItemUpdated)
    assert event == ThreadItemUpdated(
        item_id=context.workflow_item.id,
        update=WorkflowTaskUpdated(
            task=ThoughtTask(content="Thinking 1"),
            task_index=0,
        ),
    )

    # Second thought added (not streamed)
    event = await anext(stream)
    assert context.workflow_item is not None
    assert len(context.workflow_item.workflow.tasks) == 2
    assert isinstance(event, ThreadItemUpdated)
    assert event == ThreadItemUpdated(
        item_id=context.workflow_item.id,
        update=WorkflowTaskAdded(
            task=ThoughtTask(content="Thinking 2"),
            task_index=1,
        ),
    )

    try:
        while True:
            await anext(stream)
    except StopAsyncIteration:
        pass


async def test_stream_agent_response_tracks_web_search_tasks():
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call = ResponseFunctionWebSearch(
        id="ws_1",
        action=ActionSearch(type="search", query="latest news", sources=[]),
        status="in_progress",
        type="web_search_call",
    )
    tool_call_item = ToolCallItem(agent=Agent(name="Assistant"), raw_item=call)
    result.add_event(
        RunItemStreamEvent(
            name="tool_called",
            item=tool_call_item,
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseWebSearchCallSearchingEvent(
                item_id=call.id,
                output_index=0,
                sequence_number=0,
                type="response.web_search_call.searching",
            ),
        )
    )
    completed_call = ResponseFunctionWebSearch(
        id=call.id,
        action=ActionSearch(
            type="search",
            query="latest news",
            sources=[ActionSearchSource(type="url", url="https://example.com")],
        ),
        status="completed",
        type="web_search_call",
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=completed_call,
                output_index=0,
                sequence_number=1,
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    workflow_added = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemAddedEvent)
            and event.item.type == "workflow"
        ),
        None,
    )
    assert workflow_added is not None

    search_task_added = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskAdded)
            and isinstance(event.update.task, SearchTask)
        ),
        None,
    )
    assert search_task_added is not None
    assert search_task_added.update.task.queries == ["latest news"]

    search_task_completed = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskUpdated)
            and isinstance(event.update.task, SearchTask)
            and event.update.task.status_indicator == "complete"
        ),
        None,
    )
    assert search_task_completed is not None
    assert any(
        isinstance(source, URLSource) and source.url == "https://example.com"
        for source in search_task_completed.update.task.sources
    )
    assert mock_store.add_thread_item.await_count == 1


async def test_stream_agent_response_streams_tool_events_from_run_items():
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call_item = ResponseFunctionToolCallItem(
        id="call_item",
        call_id="call_1",
        name="lookup_weather",
        arguments="{\"city\": \"Paris\"}",
        status="in_progress",
        type="function_call",
    )
    result.add_event(
        RunItemStreamEvent(
            name="tool_called",
            item=ToolCallItem(agent=Agent(name="Assistant"), raw_item=call_item),
        )
    )

    call_output = FunctionCallOutput(
        type="function_call_output",
        call_id=call_item.call_id,
        output="{\"forecast\": \"sunny\"}",
        status="completed",
    )
    result.add_event(
        RunItemStreamEvent(
            name="tool_output",
            item=ToolCallOutputItem(
                agent=Agent(name="Assistant"),
                raw_item=call_output,
                output={"forecast": "sunny"},
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    workflow_added = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemAddedEvent)
            and event.item.type == "workflow"
        ),
        None,
    )
    assert workflow_added is not None

    function_events = [
        event
        for event in events
        if isinstance(event, ThreadItemUpdated)
        and isinstance(getattr(event.update, "task", None), CustomTask)
        and getattr(event.update.task, "title", None) == "lookup_weather"
    ]
    assert function_events, "Expected function call task events"

    final_update = next(
        (
            event
            for event in reversed(function_events)
            if isinstance(event.update, WorkflowTaskUpdated)
        ),
        None,
    )
    assert final_update is not None
    assert final_update.update.task.status_indicator == "complete"
    assert final_update.update.task.content is not None
    assert "sunny" in final_update.update.task.content


async def test_stream_agent_response_streams_computer_tool_events_from_run_items():
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call_item = ResponseComputerToolCall(
        id="computer_item",
        call_id="computer_call_1",
        status="in_progress",
        type="computer_call",
        action=ActionClick(type="click", x=120, y=360, button="left"),
        pending_safety_checks=[],
    )

    result.add_event(
        RunItemStreamEvent(
            name="tool_called",
            item=ToolCallItem(agent=Agent(name="Assistant"), raw_item=call_item),
        )
    )

    call_output = ComputerCallOutput(
        type="computer_call_output",
        call_id=call_item.call_id,
        status="completed",
        output=ResponseComputerToolCallOutputScreenshotParam(
            type="computer_screenshot",
            file_id="file_123",
            image_url="https://example.com/screenshot.png",
        ),
    )

    result.add_event(
        RunItemStreamEvent(
            name="tool_output",
            item=ToolCallOutputItem(
                agent=Agent(name="Assistant"),
                raw_item=call_output,
                output={
                    "image_url": "https://example.com/screenshot.png",
                    "file_id": "file_123",
                },
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    computer_task_events = [
        event
        for event in events
        if isinstance(event, ThreadItemUpdated)
        and isinstance(getattr(event.update, "task", None), ComputerUseTask)
        and getattr(event.update.task, "title", None) == "Clic"
    ]
    assert computer_task_events, "Expected computer call task events"

    final_update = next(
        (
            event
            for event in reversed(computer_task_events)
            if isinstance(event.update, WorkflowTaskUpdated)
        ),
        None,
    )
    assert final_update is not None
    assert final_update.update.task.status_indicator == "complete"
    # Check that screenshot was captured
    assert len(final_update.update.task.screenshots) > 0
    screenshot = final_update.update.task.screenshots[0]
    assert screenshot.data_url == "https://example.com/screenshot.png" or "https://example.com/screenshot.png" in (screenshot.data_url or "")


async def test_stream_agent_response_scopes_computer_tool_debug_sessions():
    mock_store.add_thread_item.reset_mock()
    tokens: list[tuple[str, str]] = []

    def _register_debug_session(debug_url: str, user_id: Any | None = None) -> str:
        token = f"token-{debug_url}"
        tokens.append((debug_url, token))
        return token

    set_debug_session_callback(_register_debug_session)

    class _StubComputerTool:
        def __init__(self, debug_url: str) -> None:
            self.computer = SimpleNamespace(debug_url=debug_url)

    async def _stream_with_tool(
        tool: Any, call_id: str, item_id: str
    ) -> ComputerUseTask:
        context = AgentContext(
            previous_response_id=None,
            thread=thread,
            store=mock_store,
            request_context=None,
        )
        result = make_result()

        call_item = ResponseComputerToolCall(
            id=item_id,
            call_id=call_id,
            status="in_progress",
            type="computer_call",
            action=ActionClick(type="click", x=120, y=360, button="left"),
            pending_safety_checks=[],
        )

        result.add_event(
            RunItemStreamEvent(
                name="tool_called",
                item=ToolCallItem(agent=Agent(name="Assistant"), raw_item=call_item),
            )
        )

        call_output = ComputerCallOutput(
            type="computer_call_output",
            call_id=call_item.call_id,
            status="completed",
            output=ResponseComputerToolCallOutputScreenshotParam(
                type="computer_screenshot",
                file_id=f"file_{call_id}",
                image_url="https://example.com/screenshot.png",
            ),
        )

        result.add_event(
            RunItemStreamEvent(
                name="tool_output",
                item=ToolCallOutputItem(
                    agent=Agent(name="Assistant"),
                    raw_item=call_output,
                    output={
                        "image_url": "https://example.com/screenshot.png",
                        "file_id": f"file_{call_id}",
                    },
                ),
            )
        )

        result.done()

        events = await all_events(
            stream_agent_response(context, result, computer_tool=tool)
        )

        final_update = next(
            (
                event
                for event in reversed(events)
                if isinstance(event, ThreadItemUpdated)
                and isinstance(getattr(event.update, "task", None), ComputerUseTask)
                and isinstance(event.update, WorkflowTaskUpdated)
            ),
            None,
        )
        assert final_update is not None
        return final_update.update.task

    tool_one = _StubComputerTool("http://debug-1")
    tool_two = _StubComputerTool("http://debug-2")

    # Seed thread-local state with the first tool
    set_current_computer_tool(tool_one)
    first_task = await _stream_with_tool(tool_one, "computer_call_1", "computer_item_1")

    # Do not clear the thread-local tool to ensure the second request passes its own
    second_task = await _stream_with_tool(tool_two, "computer_call_2", "computer_item_2")

    assert first_task.debug_url_token == "token-http://debug-1"
    assert second_task.debug_url_token == "token-http://debug-2"
    assert second_task.debug_url == "http://debug-2"
    assert tokens == [
        ("http://debug-1", "token-http://debug-1"),
        ("http://debug-2", "token-http://debug-2"),
    ]

    set_current_computer_tool(None)
    set_debug_session_callback(None)


async def test_stream_agent_response_streams_function_calls_with_reasoning():
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    reasoning_item = ResponseReasoningItem(id="resp_reasoning", summary=[], type="reasoning")
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=reasoning_item,
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.delta",
                item_id=reasoning_item.id,
                summary_index=0,
                delta="Réflexion",
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.done",
                item_id=reasoning_item.id,
                summary_index=0,
                text="Réflexion",
            ),
        )
    )

    call_item = ResponseFunctionToolCallItem(
        id="call_item",
        call_id="call_1",
        name="lookup_weather",
        arguments="",
        status="in_progress",
        type="function_call",
    )
    result.add_event(
        RunItemStreamEvent(
            name="tool_called",
            item=ToolCallItem(agent=Agent(name="Assistant"), raw_item=call_item),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=call_item,
                output_index=0,
                sequence_number=1,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseFunctionCallArgumentsDeltaEvent(
                type="response.function_call_arguments.delta",
                item_id=call_item.id,
                output_index=0,
                sequence_number=2,
                delta='{"city": ',
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseFunctionCallArgumentsDeltaEvent(
                type="response.function_call_arguments.delta",
                item_id=call_item.id,
                output_index=0,
                sequence_number=3,
                delta='"Paris"}',
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseFunctionCallArgumentsDoneEvent(
                type="response.function_call_arguments.done",
                item_id=call_item.id,
                output_index=0,
                sequence_number=4,
                name="lookup_weather",
                arguments='{"city": "Paris"}',
            ),
        )
    )

    completed_call = ResponseFunctionToolCallItem(
        id=call_item.id,
        call_id=call_item.call_id,
        name=call_item.name,
        arguments='{"city": "Paris"}',
        status="completed",
        type="function_call",
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=completed_call,
                output_index=0,
                sequence_number=5,
            ),
        )
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=SimpleNamespace(
                type="response.output_item.added",
                item=SimpleNamespace(
                    type="function_call_output",
                    call_id=call_item.call_id,
                    output='{"forecast": "sunny"}',
                    status="in_progress",
                ),
                output_index=0,
                sequence_number=6,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=SimpleNamespace(
                type="response.output_item.done",
                item=SimpleNamespace(
                    type="function_call_output",
                    call_id=call_item.call_id,
                    output='{"forecast": "sunny"}',
                    status="completed",
                ),
                output_index=0,
                sequence_number=7,
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    thought_added = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskAdded)
            and isinstance(event.update.task, ThoughtTask)
        ),
        None,
    )
    assert thought_added is not None

    function_events = [
        event
        for event in events
        if isinstance(event, ThreadItemUpdated)
        and isinstance(getattr(event.update, "task", None), CustomTask)
        and getattr(event.update.task, "title", None) == "lookup_weather"
    ]
    assert function_events, "Expected function call task events"

    assert any(
        isinstance(event.update, WorkflowTaskAdded) for event in function_events
    )

    final_update = next(
        (
            event
            for event in reversed(function_events)
            if isinstance(event.update, WorkflowTaskUpdated)
        ),
        None,
    )
    assert final_update is not None
    assert final_update.update.task.status_indicator == "complete"
    assert final_update.update.task.content is not None
    assert "Paris" in final_update.update.task.content
    assert "sunny" in final_update.update.task.content


async def test_image_generation_task_streaming():
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call = ImageGenerationCall(
        id="img_call",
        status="in_progress",
        type="image_generation_call",
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=call,
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseImageGenCallInProgressEvent(
                type="response.image_generation_call.in_progress",
                item_id=call.id,
                output_index=0,
                sequence_number=1,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseImageGenCallGeneratingEvent(
                type="response.image_generation_call.generating",
                item_id=call.id,
                output_index=0,
                sequence_number=2,
            ),
        )
    )
    partial_b64 = "cGFydGlhbA=="  # base64("partial")
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseImageGenCallPartialImageEvent(
                type="response.image_generation_call.partial_image",
                item_id=call.id,
                output_index=0,
                sequence_number=3,
                partial_image_b64=partial_b64,
                partial_image_index=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseImageGenCallCompletedEvent(
                type="response.image_generation_call.completed",
                item_id=call.id,
                output_index=0,
                sequence_number=4,
            ),
        )
    )

    final_b64 = "ZmluYWw="  # base64("final")
    completed_call = ImageGenerationCall(
        id=call.id,
        status="completed",
        type="image_generation_call",
        result=final_b64,
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=completed_call,
                output_index=0,
                sequence_number=5,
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    image_task_added = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskAdded)
            and isinstance(event.update.task, ImageTask)
        ),
        None,
    )
    assert image_task_added is not None
    assert image_task_added.update.task.status_indicator in {"loading", "complete"}
    assert image_task_added.update.task.images
    assert image_task_added.update.task.images[0].partials[-1] == partial_b64

    image_task_completed = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskUpdated)
            and isinstance(event.update.task, ImageTask)
            and event.update.task.status_indicator == "complete"
        ),
        None,
    )
    assert image_task_completed is not None
    generated_image = image_task_completed.update.task.images[0]
    assert generated_image.b64_json == final_b64
    assert generated_image.data_url is not None
    assert generated_image.data_url.startswith("data:image/")
    assert generated_image.image_url is None


async def test_image_generation_handles_url_payload(monkeypatch: pytest.MonkeyPatch):
    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call = ImageGenerationCall(
        id="img_url_call",
        status="in_progress",
        type="image_generation_call",
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=call,
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    partial_url = "https://example.test/partial.png"
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=SimpleNamespace(
                type="response.image_generation_call.partial_image",
                item_id=call.id,
                output_index=0,
                sequence_number=1,
                partial_image_index=0,
                partial_image_b64=None,
                partial_image={
                    "image_url": {"url": partial_url},
                    "output_format": "png",
                },
            ),
        )
    )

    final_url = "https://example.test/final.png"
    inlined_b64 = "aW5saW5lZA=="
    inlined_data_url = f"data:image/webp;base64,{inlined_b64}"

    def fake_inline(
        url: str,
        *,
        output_format: str | None,
        timeout: object | None = None,
    ) -> tuple[str | None, str | None, str | None]:
        return inlined_b64, inlined_data_url, output_format or "webp"

    monkeypatch.setattr("chatkit.agents._inline_remote_image", fake_inline)
    completed_call = ImageGenerationCall.model_construct(
        id=call.id,
        status="completed",
        type="image_generation_call",
        result={
            "data": [
                {
                    "image_url": {"url": final_url},
                    "output_format": "webp",
                }
            ]
        },
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=completed_call,
                output_index=0,
                sequence_number=2,
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    image_task_completed = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskUpdated)
            and isinstance(event.update.task, ImageTask)
            and event.update.task.status_indicator == "complete"
        ),
        None,
    )
    assert image_task_completed is not None
    generated_image = image_task_completed.update.task.images[0]
    assert generated_image.b64_json == inlined_b64
    assert generated_image.image_url == final_url
    assert generated_image.data_url == inlined_data_url
    assert generated_image.output_format == "webp"


async def test_image_generation_handles_url_without_inline(
    monkeypatch: pytest.MonkeyPatch,
):
    monkeypatch.setattr(
        "chatkit.agents._inline_remote_image",
        lambda *_, **__: (None, None, None),
    )

    mock_store.add_thread_item.reset_mock()
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    call = ImageGenerationCall(
        id="img_url_call_no_inline",
        status="in_progress",
        type="image_generation_call",
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=call,
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    final_url = "https://example.test/only-url.png"
    completed_call = ImageGenerationCall.model_construct(
        id=call.id,
        status="completed",
        type="image_generation_call",
        result={
            "data": [
                {
                    "image_url": {"url": final_url},
                    "output_format": "png",
                }
            ]
        },
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemDoneEvent(
                type="response.output_item.done",
                item=completed_call,
                output_index=0,
                sequence_number=1,
            ),
        )
    )

    result.done()

    events = await all_events(stream_agent_response(context, result))

    image_task_completed = next(
        (
            event
            for event in events
            if isinstance(event, ThreadItemUpdated)
            and isinstance(event.update, WorkflowTaskUpdated)
            and isinstance(event.update.task, ImageTask)
            and event.update.task.status_indicator == "complete"
        ),
        None,
    )
    assert image_task_completed is not None
    generated_image = image_task_completed.update.task.images[0]
    assert generated_image.b64_json is None
    assert generated_image.image_url == final_url
    assert generated_image.data_url == final_url
    assert generated_image.output_format == "png"


async def test_workflow_ends_on_message():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()

    # first thought
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=ResponseReasoningItem(
                    id="resp_1",
                    summary=[],
                    type="reasoning",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=Mock(
                type="response.reasoning_summary_text.done",
                item_id="resp_1",
                summary_index=0,
                text="Thinking 1",
            ),
        )
    )

    # not reasoning
    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=ResponseOutputMessage(
                    id="m_1",
                    content=[],
                    role="assistant",
                    status="in_progress",
                    type="message",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    result.done()
    stream = stream_agent_response(context, result)

    # Workflow added
    event = await anext(stream)
    assert isinstance(event, ThreadItemAddedEvent)
    assert context.workflow_item is not None
    assert context.workflow_item.workflow.type == "reasoning"
    assert len(context.workflow_item.workflow.tasks) == 0
    assert event == ThreadItemAddedEvent(item=context.workflow_item)

    # First thought done
    event = await anext(stream)
    assert context.workflow_item is not None
    assert len(context.workflow_item.workflow.tasks) == 1
    assert isinstance(event, ThreadItemUpdated)
    assert event == ThreadItemUpdated(
        item_id=context.workflow_item.id,
        update=WorkflowTaskAdded(
            task=ThoughtTask(content="Thinking 1"),
            task_index=0,
        ),
    )

    # Workflow ended
    event = await anext(stream)
    assert isinstance(event, ThreadItemDoneEvent)
    assert event.item.type == "workflow"
    assert context.workflow_item is None
    # Summary and expanded are handled by the end_workflow method
    assert isinstance(event.item.workflow.summary, DurationSummary)
    assert event.item.workflow.expanded is False

    try:
        while True:
            await anext(stream)
    except StopAsyncIteration:
        pass


async def test_existing_workflow_summary_not_overwritten_on_automatic_end():
    context = AgentContext(
        previous_response_id=None, thread=thread, store=mock_store, request_context=None
    )
    result = make_result()
    context.workflow_item = WorkflowItem(
        id="wf_1",
        created_at=datetime.now(),
        workflow=Workflow(type="custom", tasks=[], summary=CustomSummary(title="Test")),
        thread_id=thread.id,
    )

    result.add_event(
        RawResponsesStreamEvent(
            type="raw_response_event",
            data=ResponseOutputItemAddedEvent(
                type="response.output_item.added",
                item=ResponseOutputMessage(
                    id="m_1",
                    content=[],
                    role="assistant",
                    status="in_progress",
                    type="message",
                ),
                output_index=0,
                sequence_number=0,
            ),
        )
    )

    result.done()
    stream = stream_agent_response(context, result)

    event = await anext(stream)

    assert isinstance(event, ThreadItemDoneEvent)
    assert context.workflow_item is None
    assert event.item.type == "workflow"
    assert event.item.workflow.summary == CustomSummary(title="Test")

    try:
        while True:
            await anext(stream)
    except StopAsyncIteration:
        pass
