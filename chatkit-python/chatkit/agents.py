import asyncio
import base64
import json
import logging
import contextvars
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import datetime
from inspect import cleandoc
from typing import (
    Annotated,
    Any,
    AsyncGenerator,
    Awaitable,
    Generic,
    Sequence,
    TypeVar,
    assert_never,
    cast,
)
from urllib.parse import urlparse

import httpx
from agents import (
    InputGuardrailTripwireTriggered,
    OutputGuardrailTripwireTriggered,
    RunResultStreaming,
    StreamEvent,
    TResponseInputItem,
)
from openai.types.responses import (
    EasyInputMessageParam,
    ResponseComputerToolCall,
    ResponseFunctionToolCallParam,
    ResponseFunctionWebSearch,
    ResponseInputContentParam,
    ResponseInputMessageContentListParam,
    ResponseInputTextParam,
    ResponseOutputText,
    ResponseReasoningItem,
)
from openai.types.responses.response_input_item_param import (
    FunctionCallOutput,
    Message,
)
from openai.types.responses.response_output_message import Content
from openai.types.responses.response_output_text import (
    Annotation as ResponsesAnnotation,
)
from pydantic import BaseModel, ConfigDict, SkipValidation, TypeAdapter

from .server import stream_widget
from .store import Store, StoreItemType
from .types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    Attachment,
    ClientToolCallItem,
    ComputerUseScreenshot,
    ComputerUseTask,
    CustomTask,
    DurationSummary,
    EndOfTurnItem,
    FileSource,
    GeneratedImage,
    HiddenContextItem,
    ImageTask,
    SearchTask,
    Task,
    TaskItem,
    ThoughtTask,
    ThreadItem,
    ThreadItemAddedEvent,
    ThreadItemDoneEvent,
    ThreadItemRemovedEvent,
    ThreadItemUpdated,
    ThreadMetadata,
    ThreadStreamEvent,
    URLSource,
    UserMessageItem,
    UserMessageTagContent,
    UserMessageTextContent,
    WidgetItem,
    Workflow,
    WorkflowItem,
    WorkflowSummary,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)
from .widgets import Markdown, Text, WidgetRoot

LOGGER = logging.getLogger(__name__)

# Context-local storage for current computer tool (propagates across async tasks)
_computer_tool_ctx: contextvars.ContextVar[Any | None] = contextvars.ContextVar(
    "computer_tool_ctx", default=None
)

# Global callback for registering debug sessions (injected by backend)
_debug_session_callback: Any | None = None


def set_debug_session_callback(callback: Any) -> None:
    """Set the callback function for registering debug sessions (called from backend)."""
    global _debug_session_callback
    _debug_session_callback = callback
    LOGGER.info("[Agents] Debug session callback registered")


def get_debug_session_callback() -> Any | None:
    """Get the debug session callback if set."""
    return _debug_session_callback


def set_current_computer_tool(computer_tool: Any) -> None:
    """Set the current computer tool for accessing debug_url.

    This should be called from the backend when building agent tools.
    """
    _computer_tool_ctx.set(computer_tool)


def get_current_computer_tool() -> Any | None:
    """Get the current computer tool if set."""
    return _computer_tool_ctx.get()


class ClientToolCall(BaseModel):
    """
    Returned from tool methods to indicate a client-side tool call.
    """

    name: str
    arguments: dict[str, Any]


class _QueueCompleteSentinel: ...


TContext = TypeVar("TContext")


class AgentContext(BaseModel, Generic[TContext]):
    model_config = ConfigDict(arbitrary_types_allowed=True)

    thread: ThreadMetadata
    store: Annotated[Store[TContext], SkipValidation]
    request_context: TContext
    previous_response_id: str | None = None
    client_tool_call: ClientToolCall | None = None
    workflow_item: WorkflowItem | None = None
    _events: asyncio.Queue[ThreadStreamEvent | _QueueCompleteSentinel] = asyncio.Queue()

    def generate_id(
        self, type: StoreItemType, thread: ThreadMetadata | None = None
    ) -> str:
        if type == "thread":
            return self.store.generate_thread_id(self.request_context)
        return self.store.generate_item_id(
            type, thread or self.thread, self.request_context
        )

    async def stream_widget(
        self,
        widget: WidgetRoot | AsyncGenerator[WidgetRoot, None],
        copy_text: str | None = None,
    ) -> None:
        async for event in stream_widget(
            self.thread,
            widget,
            copy_text,
            lambda item_type: self.store.generate_item_id(
                item_type, self.thread, self.request_context
            ),
        ):
            await self._events.put(event)

    async def end_workflow(
        self, summary: WorkflowSummary | None = None, expanded: bool = False
    ) -> None:
        if not self.workflow_item:
            # No workflow to end
            return

        if summary is not None:
            self.workflow_item.workflow.summary = summary
        elif self.workflow_item.workflow.summary is None:
            # If no summary was set or provided, set a basic work summary
            delta = datetime.now() - self.workflow_item.created_at
            duration = int(delta.total_seconds())
            self.workflow_item.workflow.summary = DurationSummary(duration=duration)
        self.workflow_item.workflow.expanded = expanded
        await self.stream(ThreadItemDoneEvent(item=self.workflow_item))
        self.workflow_item = None

    async def start_workflow(self, workflow: Workflow) -> None:
        self.workflow_item = WorkflowItem(
            id=self.generate_id("workflow"),
            created_at=datetime.now(),
            workflow=workflow,
            thread_id=self.thread.id,
        )

        if workflow.type != "reasoning" and len(workflow.tasks) == 0:
            # Defer sending added event until we have tasks
            return

        await self.stream(ThreadItemAddedEvent(item=self.workflow_item))

    async def update_workflow_task(self, task: Task, task_index: int) -> None:
        if self.workflow_item is None:
            raise ValueError("Workflow is not set")
        # ensure reference is updated in case task is a copy
        self.workflow_item.workflow.tasks[task_index] = task
        await self.stream(
            ThreadItemUpdated(
                item_id=self.workflow_item.id,
                update=WorkflowTaskUpdated(
                    task=task,
                    task_index=task_index,
                ),
            )
        )

    async def add_workflow_task(self, task: Task) -> None:
        self.workflow_item = self.workflow_item or WorkflowItem(
            id=self.generate_id("workflow"),
            created_at=datetime.now(),
            workflow=Workflow(type="custom", tasks=[]),
            thread_id=self.thread.id,
        )
        workflow = self.workflow_item.workflow
        workflow.tasks.append(task)

        if workflow.type != "reasoning" and len(workflow.tasks) == 1:
            await self.stream(ThreadItemAddedEvent(item=self.workflow_item))
        else:
            await self.stream(
                ThreadItemUpdated(
                    item_id=self.workflow_item.id,
                    update=WorkflowTaskAdded(
                        task=task,
                        task_index=workflow.tasks.index(task),
                    ),
                )
            )

    async def stream(self, event: ThreadStreamEvent) -> None:
        await self._events.put(event)

    def _complete(self):
        self._events.put_nowait(_QueueCompleteSentinel())


def _convert_content(content: Content) -> AssistantMessageContent:
    if content.type == "output_text":
        annotations = []
        for annotation in content.annotations:
            annotations.extend(_convert_annotation(annotation))
        return AssistantMessageContent(
            text=content.text,
            annotations=annotations,
        )
    else:
        return AssistantMessageContent(
            text=content.refusal,
            annotations=[],
        )


def _convert_annotation(
    annotation: ResponsesAnnotation,
) -> list[Annotation]:
    # There is a bug in the OpenAPI client that sometimes parses the annotation delta event into the wrong class
    # resulting into annotation being a dict instead of a ResponsesAnnotation
    if isinstance(annotation, dict):
        annotation = TypeAdapter(ResponsesAnnotation).validate_python(annotation)

    result: list[Annotation] = []
    if annotation.type == "file_citation":
        filename = annotation.filename
        if not filename:
            return []
        result.append(
            Annotation(
                source=FileSource(filename=filename, title=filename),
                index=annotation.index,
            )
        )
    elif annotation.type == "url_citation":
        result.append(
            Annotation(
                source=URLSource(
                    url=annotation.url,
                    title=annotation.title,
                ),
                index=annotation.end_index,
            )
        )

    return result


T1 = TypeVar("T1")
T2 = TypeVar("T2")


async def _merge_generators(
    a: AsyncIterator[T1],
    b: AsyncIterator[T2],
) -> AsyncIterator[T1 | T2]:
    pending: list[AsyncIterator[T1 | T2]] = [a, b]
    pending_tasks: dict[asyncio.Task, AsyncIterator[T1 | T2]] = {
        asyncio.ensure_future(g.__anext__()): g for g in pending
    }
    while len(pending_tasks) > 0:
        done, _ = await asyncio.wait(
            pending_tasks.keys(), return_when="FIRST_COMPLETED"
        )
        stop = False
        for d in done:
            try:
                result = d.result()
                yield result
                dg = pending_tasks[d]
                pending_tasks[asyncio.ensure_future(dg.__anext__())] = dg
            except StopAsyncIteration:
                stop = True
            finally:
                del pending_tasks[d]
        if stop:
            for task in pending_tasks.keys():
                if not task.cancel():
                    try:
                        yield task.result()
                    except asyncio.CancelledError:
                        pass
                    except asyncio.InvalidStateError:
                        pass
            break


class _EventWrapper:
    def __init__(self, event: ThreadStreamEvent):
        self.event = event


class _AsyncQueueIterator(AsyncIterator[_EventWrapper]):
    def __init__(
        self, queue: asyncio.Queue[ThreadStreamEvent | _QueueCompleteSentinel]
    ):
        self.queue = queue
        self.completed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self.completed:
            raise StopAsyncIteration

        item = await self.queue.get()
        if isinstance(item, _QueueCompleteSentinel):
            self.completed = True
            raise StopAsyncIteration
        return _EventWrapper(item)

    def drain_and_complete(self) -> None:
        """Empty the underlying queue without awaiting and mark this iterator completed.

        This is intended for cleanup paths where we must guarantee no awaits
        occur. All queued items, including any completion sentinel, are
        discarded.
        """
        while True:
            try:
                self.queue.get_nowait()
            except asyncio.QueueEmpty:
                break
        self.completed = True


class StreamingThoughtTracker(BaseModel):
    item_id: str
    index: int
    task: ThoughtTask


class FunctionTaskTracker(BaseModel):
    item_id: str
    task: CustomTask
    call_id: str | None = None
    arguments_text: str = ""
    output_value: Any | None = None

    def update_name(self, name: str | None) -> bool:
        if not name or self.task.title == name:
            return False
        self.task.title = name
        return True

    def set_status(self, status: str | None) -> bool:
        if not status or self.task.status_indicator == status:
            return False
        if status not in {"none", "loading", "complete"}:
            return False
        self.task.status_indicator = status
        return True

    def append_arguments(self, delta: str) -> bool:
        if not delta:
            return False
        self.arguments_text += delta
        return self._sync_content()

    def set_arguments(self, arguments: str) -> bool:
        if arguments == self.arguments_text:
            return False
        self.arguments_text = arguments
        return self._sync_content()

    def set_output(self, output: Any) -> bool:
        normalized = _normalize_for_json(output) if output is not None else None
        if self.output_value == normalized:
            return False
        self.output_value = normalized
        return self._sync_content()

    def _sync_content(self) -> bool:
        previous = self.task.content
        sections: list[str] = []
        if self.arguments_text:
            sections.append(_format_markdown_section("Arguments", self.arguments_text))
        if self.output_value is not None:
            sections.append(_format_markdown_section("Résultat", self.output_value))
        content = "\n\n".join(sections).strip()
        self.task.content = content or None
        return self.task.content != previous


class SearchTaskTracker(BaseModel):
    item_id: str
    task: SearchTask


_COMPUTER_ACTION_TITLES: dict[str, str] = {
    "click": "Clic",
    "double_click": "Double clic",
    "drag": "Glisser",
    "keypress": "Appuyer sur une touche",
    "move": "Déplacement",
    "screenshot": "Capture d'écran",
    "scroll": "Défilement",
    "type": "Saisie",
    "wait": "Attente",
}


class ComputerTaskTracker(BaseModel):
    item_id: str
    task: ComputerUseTask
    call_id: str | None = None
    action_data: Any | None = None
    pending_checks: Any | None = None
    output_data: Any | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def set_call_id(self, call_id: str | None) -> tuple[bool, str | None]:
        if call_id is None or call_id == self.call_id:
            return False, None
        previous = self.call_id
        self.call_id = call_id
        return True, previous

    def set_status(self, status: str | None) -> bool:
        indicator = _computer_status_indicator(status)
        if indicator is None or indicator == self.task.status_indicator:
            return False
        self.task.status_indicator = indicator
        return True

    def _set_action_data(self, value: Any | None) -> bool:
        if value == self.action_data:
            return False
        self.action_data = value
        return True

    def _set_pending_checks(self, value: Any | None) -> bool:
        if value == self.pending_checks:
            return False
        self.pending_checks = value
        return True

    def _set_output_data(self, value: Any | None) -> bool:
        if value == self.output_data:
            return False
        self.output_data = value
        return True

    def _sync_title(self) -> bool:
        action_type = None
        if isinstance(self.action_data, dict):
            action_type = self.action_data.get("type")
        if not isinstance(action_type, str):
            return False
        normalized = action_type.strip().lower()
        if not normalized:
            return False
        title = _COMPUTER_ACTION_TITLES.get(
            normalized, normalized.replace("_", " ").capitalize()
        )
        if self.task.title == title:
            return False
        self.task.title = title
        return True

    def _sync_current_action(self) -> bool:
        """Update current_action from action_data."""
        if not isinstance(self.action_data, dict):
            return False

        action_type = self.action_data.get("type", "")
        if not action_type:
            return False

        # Format a readable action description
        action_desc = _COMPUTER_ACTION_TITLES.get(
            action_type, action_type.replace("_", " ").capitalize()
        )

        # Add action details
        details = []
        if action_type in ("click", "double_click"):
            x = self.action_data.get("x")
            y = self.action_data.get("y")
            if x is not None and y is not None:
                details.append(f"à ({x}, {y})")
        elif action_type == "type":
            text = self.action_data.get("text", "")
            if text:
                details.append(f'"{text}"')
        elif action_type == "keypress":
            key = self.action_data.get("key", "")
            if key:
                details.append(f'touche "{key}"')

        new_action = f"{action_desc} {' '.join(details)}".strip()
        if self.task.current_action == new_action:
            return False

        self.task.current_action = new_action
        return True

    def _add_to_action_sequence(self, action: str) -> bool:
        """Add an action to the action sequence if not already present."""
        if not action or (self.task.action_sequence and self.task.action_sequence[-1] == action):
            return False
        self.task.action_sequence.append(action)
        return True

    def update_from_call(
        self, call: ResponseComputerToolCall
    ) -> tuple[bool, str | None]:
        call_id_changed, previous_call_id = self.set_call_id(
            getattr(call, "call_id", None)
        )
        changed = call_id_changed
        changed |= self.set_status(getattr(call, "status", None))
        changed |= self._set_action_data(_normalize_for_json(getattr(call, "action", None)))
        pending = getattr(call, "pending_safety_checks", None)
        normalized_pending = (
            _normalize_for_json(pending) if pending else None
        )
        changed |= self._set_pending_checks(normalized_pending)
        changed |= self._sync_title()
        changed |= self._sync_current_action()

        # Add action to sequence if we have a current action
        if self.task.current_action:
            changed |= self._add_to_action_sequence(self.task.current_action)

        return changed, previous_call_id

    def update_from_output(
        self,
        *,
        call_id: str | None,
        status: str | None,
        raw_output: Any = None,
        parsed_output: Any = None,
    ) -> tuple[bool, str | None]:
        call_id_changed, previous_call_id = self.set_call_id(call_id)
        changed = call_id_changed
        changed |= self.set_status(status)

        # Extract screenshot information from output
        output_value = raw_output if raw_output is not None else parsed_output
        if output_value is not None:
            changed |= self._set_output_data(_normalize_for_json(output_value))

            # Check if this is a screenshot output
            output_type = None
            if isinstance(output_value, dict):
                output_type = output_value.get("type")
            elif hasattr(output_value, "type"):
                output_type = getattr(output_value, "type", None)

            LOGGER.debug(
                f"[ComputerTaskTracker] update_from_output: output_type={output_type}, "
                f"raw_output type={type(raw_output).__name__}"
            )

            if output_type == "computer_screenshot":
                # Extract screenshot data
                screenshot_id = self.call_id or f"screenshot_{len(self.task.screenshots)}"

                # Try to get image data from various sources
                # Could be in image_url, b64_image, data, or other fields
                image_url = None
                b64_data = None

                if isinstance(output_value, dict):
                    image_url = output_value.get("image_url")
                    b64_data = output_value.get("b64_image") or output_value.get("data") or output_value.get("base64")
                elif hasattr(output_value, "image_url"):
                    image_url = getattr(output_value, "image_url", None)
                    b64_data = (
                        getattr(output_value, "b64_image", None)
                        or getattr(output_value, "data", None)
                        or getattr(output_value, "base64", None)
                    )

                # Also check parsed_output
                if not image_url and not b64_data and parsed_output and isinstance(parsed_output, dict):
                    image_url = parsed_output.get("image_url")
                    b64_data = parsed_output.get("b64_image") or parsed_output.get("data") or parsed_output.get("base64")

                LOGGER.info(
                    f"[ComputerTaskTracker] Screenshot extraction: "
                    f"image_url={'<present>' if image_url else 'None'}, "
                    f"b64_data={'<present, {len(b64_data)} chars>' if b64_data else 'None'}"
                )

                # Use b64_data if available, otherwise fall back to image_url
                source_data = b64_data or image_url
                if source_data:
                    # Create a ComputerUseScreenshot
                    data_url = None
                    b64_image = None

                    if isinstance(source_data, str):
                        if source_data.startswith("data:image/"):
                            # It's already a data URL
                            data_url = source_data
                            # Extract base64 part if needed
                            if ";base64," in source_data:
                                b64_image = source_data.split(";base64,", 1)[1]
                        elif source_data.startswith("http://") or source_data.startswith("https://"):
                            # It's a remote URL - download and inline it like ImageTask does
                            inline_b64, inline_data_url, _ = _inline_remote_image(
                                source_data,
                                output_format="png",
                            )
                            if inline_b64 and inline_data_url:
                                b64_image = inline_b64
                                data_url = inline_data_url
                            else:
                                # Fallback to the URL if download fails
                                data_url = source_data
                        else:
                            # Assume it's base64 encoded image (from Playwright)
                            b64_image = source_data
                            data_url = f"data:image/png;base64,{source_data}"

                    screenshot = ComputerUseScreenshot(
                        id=screenshot_id,
                        b64_image=b64_image,
                        data_url=data_url,
                        action_description=self.task.current_action,
                    )

                    # Add or update the screenshot
                    # Check if we should update the last screenshot or add a new one
                    if self.task.screenshots and self.task.screenshots[-1].id == screenshot_id:
                        self.task.screenshots[-1] = screenshot
                    else:
                        self.task.screenshots.append(screenshot)

                    LOGGER.debug(
                        f"[ComputerTaskTracker] Screenshot added: id={screenshot_id}, "
                        f"has_b64={b64_image is not None}, has_data_url={data_url is not None}, "
                        f"total_screenshots={len(self.task.screenshots)}"
                    )

                    changed = True

        return changed, previous_call_id


def _computer_status_indicator(status: str | None) -> str | None:
    if status == "completed":
        return "complete"
    if status in {"in_progress", "generating"}:
        return "loading"
    if status == "incomplete":
        return "none"
    return None


@dataclass
class ImageTaskTracker:
    item_id: str
    output_index: int
    task: ImageTask
    last_inlined_url: str | None = None

    def ensure_image(self) -> GeneratedImage:
        if self.task.images:
            return self.task.images[0]
        image = GeneratedImage(id=f"{self.item_id}:{self.output_index}")
        self.task.images.append(image)
        return image


def _image_data_url(b64_data: str, output_format: str | None) -> str:
    """Format a base64 image payload as a data URL."""

    fmt = (output_format or "png").lower()
    if fmt == "auto":
        fmt = "png"
    return f"data:image/{fmt};base64,{b64_data}"


def _coerce_optional_str(value: Any) -> str | None:
    if isinstance(value, str):
        stripped = value.strip()
        if stripped:
            return stripped
    return None


def _guess_format_from_url(url: str) -> str | None:
    try:
        path = urlparse(url).path
    except ValueError:
        return None
    if "." not in path:
        return None
    extension = path.rsplit(".", 1)[-1]
    return _normalize_image_format(extension)


def _inline_remote_image(
    url: str,
    *,
    output_format: str | None,
    timeout: httpx.Timeout | None = None,
) -> tuple[str | None, str | None, str | None]:
    """Télécharge une image distante pour produire une version inline base64."""

    candidate = _coerce_optional_str(url)
    if candidate is None or candidate.startswith("data:"):
        return None, None, None

    if timeout is None:
        timeout = httpx.Timeout(15.0, connect=5.0)

    try:
        with httpx.Client(timeout=timeout) as client:
            response = client.get(candidate)
        response.raise_for_status()
    except Exception:  # pragma: no cover - dépend des conditions réseau
        LOGGER.debug("Échec du téléchargement de l'image %s", candidate, exc_info=True)
        return None, None, None

    content_type = response.headers.get("content-type")
    inferred_format = (
        _normalize_image_format(content_type)
        or _guess_format_from_url(candidate)
        or output_format
    )

    try:
        encoded = base64.b64encode(response.content).decode("ascii")
    except Exception:  # pragma: no cover - dépend du contenu retourné
        LOGGER.debug("Impossible d'encoder l'image %s en base64", candidate, exc_info=True)
        return None, None, None

    data_url = _image_data_url(encoded, inferred_format)
    return encoded, data_url, inferred_format


def _normalize_image_format(value: Any) -> str | None:
    candidate = _coerce_optional_str(value)
    if candidate is None:
        return None
    if candidate.startswith("image/"):
        candidate = candidate.split("/", 1)[1]
    if candidate == "jpg":
        candidate = "jpeg"
    if candidate in {"png", "jpeg", "webp", "auto"}:
        return candidate
    return None


def _extract_url(candidate: Any) -> str | None:
    if candidate is None:
        return None
    if hasattr(candidate, "model_dump"):
        try:
            candidate = candidate.model_dump()
        except Exception:  # pragma: no cover - dépend du modèle fourni
            pass
    result = _coerce_optional_str(candidate)
    if result is not None:
        return result
    if isinstance(candidate, dict):
        for key in ("url", "href", "data", "value"):
            nested = _extract_url(candidate.get(key))
            if nested is not None:
                return nested
    return None


def _extract_image_payload(value: Any, *, output_index: int = 0) -> tuple[str | None, str | None, str | None]:
    """Returns (base64, url, format) from arbitrary image payloads."""

    if value is None:
        return None, None, None

    if hasattr(value, "model_dump"):
        try:
            value = value.model_dump()
        except Exception:  # pragma: no cover - dépend du modèle fourni
            pass

    if isinstance(value, str):
        text = _coerce_optional_str(value)
        if text is None:
            return None, None, None
        if text.startswith("data:") or "://" in text:
            return None, text, None
        return text, None, None

    if isinstance(value, (list, tuple)):
        if not value:
            return None, None, None
        index = output_index if 0 <= output_index < len(value) else 0
        return _extract_image_payload(value[index], output_index=output_index)

    if isinstance(value, dict):
        for key in ("data", "images", "outputs", "items", "content"):
            nested = value.get(key)
            if isinstance(nested, (list, tuple)) and nested:
                index = output_index if 0 <= output_index < len(nested) else 0
                return _extract_image_payload(nested[index], output_index=output_index)

        b64 = _coerce_optional_str(
            value.get("b64_json")
            or value.get("base64")
            or value.get("image_base64")
        )
        url = _extract_url(value.get("image_url")) or _extract_url(value.get("url"))
        fmt = _normalize_image_format(
            value.get("output_format")
            or value.get("format")
            or value.get("mime_type")
            or value.get("media_type")
        )

        image_entry = value.get("image")
        if image_entry is not None:
            nested_b64, nested_url, nested_fmt = _extract_image_payload(
                image_entry, output_index=output_index
            )
            b64 = b64 or nested_b64
            url = url or nested_url
            fmt = fmt or nested_fmt

        return b64, url, fmt

    # Attribute-based objects (Pydantic models, SimpleNamespace, etc.)
    for attr in ("data", "images", "outputs", "items", "content"):
        nested = getattr(value, attr, None)
        if isinstance(nested, (list, tuple)) and nested:
            index = output_index if 0 <= output_index < len(nested) else 0
            return _extract_image_payload(nested[index], output_index=output_index)

    b64 = _coerce_optional_str(
        getattr(value, "b64_json", None)
        or getattr(value, "base64", None)
        or getattr(value, "image_base64", None)
    )
    url = _extract_url(getattr(value, "image_url", None)) or _extract_url(
        getattr(value, "url", None)
    )
    fmt = _normalize_image_format(
        getattr(value, "output_format", None)
        or getattr(value, "format", None)
        or getattr(value, "mime_type", None)
    )

    return b64, url, fmt


def _event_attr(event: Any, attribute: str) -> Any:
    if hasattr(event, attribute):
        return getattr(event, attribute)
    if isinstance(event, dict):
        return event.get(attribute)
    return None


def _normalize_for_json(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: _normalize_for_json(val) for key, val in value.items()}
    if isinstance(value, list):
        return [_normalize_for_json(item) for item in value]
    if hasattr(value, "model_dump"):
        try:
            return value.model_dump(mode="json")
        except TypeError:
            return value.model_dump()
    return value


def _format_string_content(value: str) -> str:
    stripped = value.strip()
    if not stripped:
        return value
    try:
        parsed = json.loads(value)
    except (json.JSONDecodeError, TypeError):
        return value
    return json.dumps(parsed, ensure_ascii=False, indent=2)


def _format_markdown_section(label: str, value: Any) -> str:
    if isinstance(value, str):
        text = _format_string_content(value)
    else:
        normalized = _normalize_for_json(value)
        try:
            text = json.dumps(normalized, ensure_ascii=False, indent=2)
        except (TypeError, ValueError):
            text = str(normalized)
    if "\n" in text:
        return f"{label} :\n```\n{text}\n```"
    return f"{label} : {text}"


async def stream_agent_response(
    context: AgentContext, result: RunResultStreaming
) -> AsyncIterator[ThreadStreamEvent]:
    current_item_id = None
    current_tool_call = None
    ctx = context
    thread = context.thread
    queue_iterator = _AsyncQueueIterator(context._events)
    produced_items = set()
    streaming_thought: None | StreamingThoughtTracker = None
    search_tasks: dict[str, SearchTaskTracker] = {}
    image_tasks: dict[tuple[str, int], ImageTaskTracker] = {}
    computer_tasks: dict[str, ComputerTaskTracker] = {}
    computer_tasks_by_call_id: dict[str, ComputerTaskTracker] = {}
    function_tasks: dict[str, FunctionTaskTracker] = {}
    function_tasks_by_call_id: dict[str, FunctionTaskTracker] = {}
    current_reasoning_id: str | None = None

    def _get_value(raw: Any, key: str) -> Any:
        if isinstance(raw, dict):
            return raw.get(key)
        return getattr(raw, key, None)

    # check if the last item in the thread was a workflow or a client tool call
    # if it was a client tool call, check if the second last item was a workflow
    # if either was, continue the workflow
    items = await context.store.load_thread_items(
        thread.id, None, 2, "desc", context.request_context
    )
    last_item = items.data[0] if len(items.data) > 0 else None
    second_last_item = items.data[1] if len(items.data) > 1 else None

    if last_item and last_item.type == "workflow":
        ctx.workflow_item = last_item
    elif (
        last_item
        and last_item.type == "client_tool_call"
        and second_last_item
        and second_last_item.type == "workflow"
    ):
        ctx.workflow_item = second_last_item

    def end_workflow(item: WorkflowItem):
        nonlocal search_tasks, image_tasks
        if item == ctx.workflow_item:
            ctx.workflow_item = None
        delta = datetime.now() - item.created_at
        duration = int(delta.total_seconds())
        if item.workflow.summary is None:
            item.workflow.summary = DurationSummary(duration=duration)
        # Default to closing all workflows
        # To keep a workflow open on completion, close it explicitly with
        # AgentContext.end_workflow(expanded=True)
        item.workflow.expanded = False
        search_tasks.clear()
        image_tasks.clear()
        computer_tasks.clear()
        computer_tasks_by_call_id.clear()
        function_tasks.clear()
        function_tasks_by_call_id.clear()
        return ThreadItemDoneEvent(item=item)

    def ensure_workflow() -> list[ThreadStreamEvent]:
        events: list[ThreadStreamEvent] = []
        if not ctx.workflow_item:
            ctx.workflow_item = WorkflowItem(
                id=ctx.generate_id("workflow"),
                created_at=datetime.now(),
                workflow=Workflow(type="reasoning", tasks=[]),
                thread_id=thread.id,
            )
            produced_items.add(ctx.workflow_item.id)
            events.append(ThreadItemAddedEvent(item=ctx.workflow_item))
        return events

    def ensure_search_task(
        item_id: str,
    ) -> tuple[SearchTaskTracker, bool, list[ThreadStreamEvent]]:
        events = ensure_workflow()
        tracker = search_tasks.get(item_id)
        if not tracker:
            tracker = SearchTaskTracker(
                item_id=item_id,
                task=SearchTask(status_indicator="loading"),
            )
            search_tasks[item_id] = tracker
        task_added = False
        if ctx.workflow_item and tracker.task not in ctx.workflow_item.workflow.tasks:
            ctx.workflow_item.workflow.tasks.append(tracker.task)
            task_added = True
        return tracker, task_added, events

    def apply_search_task_updates(
        tracker: SearchTaskTracker,
        *,
        status: str | None = None,
        call: ResponseFunctionWebSearch | None = None,
    ) -> bool:
        updated = False
        task = tracker.task
        if status is not None and task.status_indicator != status:
            task.status_indicator = status
            updated = True
        if call is None:
            return updated

        action = call.action
        action_type = getattr(action, "type", None)
        if action_type == "search":
            query = getattr(action, "query", None)
            if query:
                if task.title != query:
                    task.title = query
                    updated = True
                if task.title_query != query:
                    task.title_query = query
                    updated = True
                if query not in task.queries:
                    task.queries.append(query)
                    updated = True
            sources = getattr(action, "sources", None) or []
            if sources:
                existing_urls = {source.url for source in task.sources}
                new_sources = []
                for source in sources:
                    if source.url not in existing_urls:
                        new_sources.append(
                            URLSource(
                                title=source.url,
                                url=source.url,
                            )
                        )
                        existing_urls.add(source.url)
                if new_sources:
                    task.sources.extend(new_sources)
                    updated = True
        elif action_type in {"open_page", "find"}:
            url = getattr(action, "url", None)
            if url:
                if task.title is None:
                    task.title = url
                    updated = True
                existing_urls = {source.url for source in task.sources}
                if url not in existing_urls:
                    task.sources.append(URLSource(title=url, url=url))
                    updated = True
        return updated

    def ensure_image_task(
        item_id: str, output_index: int
    ) -> tuple[ImageTaskTracker, bool, list[ThreadStreamEvent]]:
        events = ensure_workflow()
        key = (item_id, output_index)
        tracker = image_tasks.get(key)
        if tracker is None:
            tracker = ImageTaskTracker(
                item_id=item_id,
                output_index=output_index,
                task=ImageTask(
                    status_indicator="loading",
                    call_id=item_id,
                    output_index=output_index,
                ),
            )
            tracker.ensure_image()
            image_tasks[key] = tracker
        else:
            tracker.ensure_image()

        task_added = False
        if ctx.workflow_item and tracker.task not in ctx.workflow_item.workflow.tasks:
            ctx.workflow_item.workflow.tasks.append(tracker.task)
            task_added = True
        return tracker, task_added, events

    def apply_image_task_updates(
        tracker: ImageTaskTracker,
        *,
        status: str | None = None,
        final_b64: str | None = None,
        final_url: str | None = None,
        partial_b64: str | None = None,
        partial_url: str | None = None,
        output_format: str | None = None,
    ) -> bool:
        updated = False
        task = tracker.task
        image = tracker.ensure_image()

        if status is not None and task.status_indicator != status:
            task.status_indicator = status
            updated = True

        normalized_format = _normalize_image_format(output_format)
        if normalized_format is not None and image.output_format != normalized_format:
            image.output_format = normalized_format
            updated = True

        def _inline_from_url(url: str | None) -> bool:
            candidate = _coerce_optional_str(url)
            if candidate is None or candidate.startswith("data:"):
                return False
            if isinstance(image.b64_json, str):
                return False
            if tracker.last_inlined_url == candidate:
                return False
            tracker.last_inlined_url = candidate
            inline_b64, inline_data_url, inline_format = _inline_remote_image(
                candidate,
                output_format=image.output_format or normalized_format,
            )
            changed = False
            if inline_b64 and image.b64_json != inline_b64:
                image.b64_json = inline_b64
                changed = True
            if inline_data_url and image.data_url != inline_data_url:
                image.data_url = inline_data_url
                changed = True
            if inline_format and image.output_format != inline_format:
                image.output_format = inline_format
                changed = True
            return changed

        if isinstance(partial_b64, str):
            if not image.partials or image.partials[-1] != partial_b64:
                image.partials.append(partial_b64)
            if image.b64_json != partial_b64:
                image.b64_json = partial_b64
                image.data_url = _image_data_url(partial_b64, image.output_format)
                updated = True

        def _update_image_url(url: str | None) -> bool:
            candidate = _coerce_optional_str(url)
            if candidate is None:
                return False
            changed = False
            if getattr(image, "image_url", None) != candidate:
                image.image_url = candidate
                changed = True
            if (
                candidate.startswith("data:")
                or not isinstance(image.b64_json, str)
                or not image.data_url
            ) and image.data_url != candidate:
                image.data_url = candidate
                changed = True
            return changed

        if _update_image_url(partial_url):
            updated = True

        if isinstance(final_b64, str) and image.b64_json != final_b64:
            image.b64_json = final_b64
            image.data_url = _image_data_url(final_b64, image.output_format)
            updated = True

        if _update_image_url(final_url):
            updated = True

        if not isinstance(image.b64_json, str):
            if _inline_from_url(final_url):
                updated = True
            elif _inline_from_url(partial_url):
                updated = True

        return updated

    def ensure_function_task(
        item_id: str,
        *,
        name: str | None = None,
        call_id: str | None = None,
    ) -> tuple[FunctionTaskTracker, bool, list[ThreadStreamEvent]]:
        events = ensure_workflow()
        tracker = function_tasks.get(item_id)
        task_added = False

        if tracker is None:
            tracker = FunctionTaskTracker(
                item_id=item_id,
                task=CustomTask(status_indicator="loading", title=name, content=None),
                call_id=call_id,
            )
            function_tasks[item_id] = tracker
            if ctx.workflow_item and tracker.task not in ctx.workflow_item.workflow.tasks:
                ctx.workflow_item.workflow.tasks.append(tracker.task)
                task_added = True

        if call_id:
            previous_call_id = tracker.call_id
            if previous_call_id and previous_call_id != call_id:
                existing = function_tasks_by_call_id.get(previous_call_id)
                if existing is tracker:
                    del function_tasks_by_call_id[previous_call_id]
            tracker.call_id = call_id
            function_tasks_by_call_id[call_id] = tracker
        elif tracker.call_id:
            function_tasks_by_call_id.setdefault(tracker.call_id, tracker)

        if name:
            tracker.update_name(name)

        return tracker, task_added, events

    def get_function_task_by_call_id(
        call_id: str | None,
    ) -> FunctionTaskTracker | None:
        if not call_id:
            return None
        tracker = function_tasks_by_call_id.get(call_id)
        if tracker:
            return tracker
        for candidate in function_tasks.values():
            if candidate.call_id == call_id:
                function_tasks_by_call_id[call_id] = candidate
                return candidate
        return None

    def apply_function_task_updates(
        tracker: FunctionTaskTracker,
        *,
        status: str | None = None,
        arguments: str | None = None,
        arguments_delta: str | None = None,
        output: Any | None = None,
        name: str | None = None,
    ) -> bool:
        updated = False
        if name:
            updated |= tracker.update_name(name)
        if arguments_delta:
            updated |= tracker.append_arguments(arguments_delta)
        if arguments is not None:
            updated |= tracker.set_arguments(arguments)
        if status is not None:
            indicator = "complete" if status == "completed" else "loading"
            updated |= tracker.set_status(indicator)
        if output is not None:
            updated |= tracker.set_output(output)
        return updated

    def ensure_computer_task(
        item_id: str,
        *,
        call_id: str | None = None,
    ) -> tuple[ComputerTaskTracker, bool, list[ThreadStreamEvent]]:
        events = ensure_workflow()
        tracker = computer_tasks.get(item_id)
        task_added = False

        if tracker is None:
            # Get debug_url from computer_tool if available and register a secure session
            debug_url = None
            debug_url_token = None
            computer_tool = get_current_computer_tool()
            if computer_tool is not None:
                try:
                    computer = getattr(computer_tool, "computer", None)
                    if computer is not None:
                        debug_url = getattr(computer, "debug_url", None)
                        if callable(debug_url):
                            debug_url = debug_url()
                        if debug_url:
                            LOGGER.info(f"[ComputerTaskTracker] Obtained debug_url: {debug_url}")
                            # Register a secure debug session for proxy access
                            callback = get_debug_session_callback()
                            if callback is not None:
                                try:
                                    # TODO: Pass user_id for better authorization
                                    debug_url_token = callback(debug_url, user_id=None)
                                    LOGGER.info(f"[ComputerTaskTracker] Registered debug session token: {debug_url_token[:8]}...")
                                except Exception as exc:
                                    LOGGER.warning(f"[ComputerTaskTracker] Failed to register debug session: {exc}")
                            else:
                                LOGGER.warning("[ComputerTaskTracker] Debug session callback not set - screencast will not be available")
                except Exception as exc:
                    LOGGER.debug(f"[ComputerTaskTracker] Failed to get debug_url: {exc}")

            tracker = ComputerTaskTracker(
                item_id=item_id,
                task=ComputerUseTask(
                    status_indicator="loading",
                    title=None,
                    screenshots=[],
                    action_sequence=[],
                    debug_url=debug_url,
                    debug_url_token=debug_url_token,
                ),
            )
            computer_tasks[item_id] = tracker

        removed_call_id: str | None = None
        if call_id:
            call_id_changed, removed_call_id = tracker.set_call_id(call_id)
            if call_id_changed and removed_call_id:
                existing = computer_tasks_by_call_id.get(removed_call_id)
                if existing is tracker:
                    del computer_tasks_by_call_id[removed_call_id]

        if tracker.call_id:
            computer_tasks_by_call_id[tracker.call_id] = tracker

        if ctx.workflow_item and tracker.task not in ctx.workflow_item.workflow.tasks:
            ctx.workflow_item.workflow.tasks.append(tracker.task)
            task_added = True

        return tracker, task_added, events

    def get_computer_task_by_call_id(
        call_id: str | None,
    ) -> ComputerTaskTracker | None:
        if not call_id:
            return None
        tracker = computer_tasks_by_call_id.get(call_id)
        if tracker:
            return tracker
        for candidate in computer_tasks.values():
            if candidate.call_id == call_id:
                computer_tasks_by_call_id[call_id] = candidate
                return candidate
        return None

    def apply_computer_call_updates(
        tracker: ComputerTaskTracker,
        call: ResponseComputerToolCall,
    ) -> bool:
        updated, previous_call_id = tracker.update_from_call(call)
        if previous_call_id:
            existing = computer_tasks_by_call_id.get(previous_call_id)
            if existing is tracker:
                del computer_tasks_by_call_id[previous_call_id]
        if tracker.call_id:
            computer_tasks_by_call_id[tracker.call_id] = tracker
        return updated

    def apply_computer_output_updates(
        tracker: ComputerTaskTracker,
        *,
        call_id: str | None,
        status: str | None,
        raw_output: Any = None,
        parsed_output: Any = None,
    ) -> bool:
        # Check if we need to register debug session after browser is ready
        if tracker.task.debug_url_token is None:
            computer_tool = get_current_computer_tool()
            if computer_tool is not None:
                try:
                    computer = getattr(computer_tool, "computer", None)
                    if computer is not None:
                        debug_url = getattr(computer, "debug_url", None)
                        if callable(debug_url):
                            debug_url = debug_url()
                        if debug_url:
                            LOGGER.info(f"[ComputerTaskTracker] Browser started, obtained debug_url: {debug_url}")
                            callback = get_debug_session_callback()
                            if callback is not None:
                                try:
                                    debug_url_token = callback(debug_url, user_id=None)
                                    tracker.task.debug_url_token = debug_url_token
                                    tracker.task.debug_url = debug_url
                                    LOGGER.info(f"[ComputerTaskTracker] Registered debug session token after browser start: {debug_url_token[:8]}...")
                                except Exception as exc:
                                    LOGGER.warning(f"[ComputerTaskTracker] Failed to register debug session: {exc}")
                except Exception as exc:
                    LOGGER.debug(f"[ComputerTaskTracker] Failed to update debug_url: {exc}")

        updated, previous_call_id = tracker.update_from_output(
            call_id=call_id,
            status=status,
            raw_output=raw_output,
            parsed_output=parsed_output,
        )
        if previous_call_id:
            existing = computer_tasks_by_call_id.get(previous_call_id)
            if existing is tracker:
                del computer_tasks_by_call_id[previous_call_id]
        if tracker.call_id:
            computer_tasks_by_call_id[tracker.call_id] = tracker
        return updated

    def search_status_from_call(call: ResponseFunctionWebSearch) -> str:
        if call.status == "completed":
            return "complete"
        if call.status in {"in_progress", "searching"}:
            return "loading"
        return "none"

    def upsert_search_task(
        call: ResponseFunctionWebSearch, *, status: str | None = None
    ) -> list[ThreadStreamEvent]:
        tracker, task_added, events = ensure_search_task(call.id)
        effective_status = status or search_status_from_call(call)
        updated = apply_search_task_updates(
            tracker,
            status=effective_status,
            call=call,
        )
        if ctx.workflow_item:
            task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
            if task_added:
                events.append(
                    ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskAdded(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
                )
            elif updated:
                events.append(
                    ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskUpdated(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
                )
        return events

    def update_search_task_status(
        item_id: str, status: str
    ) -> list[ThreadStreamEvent]:
        tracker, task_added, events = ensure_search_task(item_id)
        updated = apply_search_task_updates(tracker, status=status)
        if ctx.workflow_item:
            task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
            if task_added:
                events.append(
                    ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskAdded(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
                )
            elif updated:
                events.append(
                    ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskUpdated(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
                )
        return events

    async def safe_stream_events():
        """Wrapper to handle streaming errors gracefully, particularly from Groq API."""
        try:
            async for event in result.stream_events():
                yield event
        except Exception as e:
            # Check if this is a litellm streaming error (e.g., missing 'id' field)
            error_msg = str(e)
            if "KeyError" in error_msg or "'id'" in error_msg or "GroqException" in error_msg:
                LOGGER.warning(
                    "Streaming error from provider (possibly malformed chunk): %s. "
                    "Attempting to continue...",
                    error_msg,
                )
                # Don't re-raise - allow the stream to end gracefully
                return
            # For other errors, re-raise
            raise

    try:
        async for event in _merge_generators(safe_stream_events(), queue_iterator):
            # Events emitted from agent context helpers
            if isinstance(event, _EventWrapper):
                event = event.event
                if (
                    event.type == "thread.item.added"
                    or event.type == "thread.item.done"
                ):
                    # End the current workflow if visual item is added after it
                    if (
                        ctx.workflow_item
                        and ctx.workflow_item.id != event.item.id
                        and event.item.type != "client_tool_call"
                        and event.item.type != "hidden_context_item"
                    ):
                        yield end_workflow(ctx.workflow_item)

                    # track the current workflow if one is added
                    if (
                        event.type == "thread.item.added"
                        and event.item.type == "workflow"
                    ):
                        ctx.workflow_item = event.item
                        search_tasks.clear()
                        image_tasks.clear()
                        function_tasks.clear()
                        function_tasks_by_call_id.clear()

                    # track integration produced items so we can clean them up if
                    # there is a guardrail tripwire
                    produced_items.add(event.item.id)
                yield event
                continue

            if event.type == "run_item_stream_event":
                run_item_event = event
                event_item = run_item_event.item
                if (
                    run_item_event.name == "tool_called"
                    and event_item.type == "tool_call_item"
                ):
                    raw_item = event_item.raw_item
                    if _get_value(raw_item, "type") == "function_call":
                        current_tool_call = _get_value(raw_item, "call_id")
                        current_item_id = _get_value(raw_item, "id")
                        if current_item_id:
                            produced_items.add(current_item_id)
                        tracker, task_added, workflow_events = ensure_function_task(
                            _get_value(raw_item, "id") or "",
                            name=_get_value(raw_item, "name"),
                            call_id=_get_value(raw_item, "call_id"),
                        )
                        for workflow_event in workflow_events:
                            yield workflow_event
                        updated = apply_function_task_updates(
                            tracker,
                            status=_get_value(raw_item, "status"),
                            arguments=_get_value(raw_item, "arguments"),
                            name=_get_value(raw_item, "name"),
                        )
                        if ctx.workflow_item and (task_added or updated):
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            update_cls = (
                                WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=update_cls(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                    elif _get_value(raw_item, "type") == "web_search_call":
                        for search_event in upsert_search_task(
                            cast(ResponseFunctionWebSearch, raw_item),
                            status="loading",
                        ):
                            yield search_event
                    elif _get_value(raw_item, "type") == "computer_call":
                        call_id = _get_value(raw_item, "call_id")
                        item_id = _get_value(raw_item, "id") or ""
                        if item_id:
                            produced_items.add(item_id)
                        tracker, task_added, workflow_events = ensure_computer_task(
                            item_id,
                            call_id=call_id,
                        )
                        for workflow_event in workflow_events:
                            yield workflow_event
                        updated = apply_computer_call_updates(
                            tracker,
                            cast(ResponseComputerToolCall, raw_item),
                        )
                        if ctx.workflow_item and (task_added or updated):
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            update_cls = (
                                WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=update_cls(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                elif (
                    run_item_event.name == "tool_output"
                    and event_item.type == "tool_call_output_item"
                ):
                    raw_item = event_item.raw_item
                    call_id = _get_value(raw_item, "call_id")
                    tracker = get_function_task_by_call_id(call_id)
                    if tracker is not None:
                        status = _get_value(raw_item, "status")
                        updated = apply_function_task_updates(
                            tracker,
                            status=status,
                            output=getattr(event_item, "output", None),
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                    elif _get_value(raw_item, "type") == "computer_call_output":
                        tracker = get_computer_task_by_call_id(call_id)
                        if tracker is not None:
                            status = _get_value(raw_item, "status")
                            updated = apply_computer_output_updates(
                                tracker,
                                call_id=call_id,
                                status=status,
                                raw_output=_get_value(raw_item, "output"),
                                parsed_output=getattr(event_item, "output", None),
                            )
                            if ctx.workflow_item and updated:
                                task_index = ctx.workflow_item.workflow.tasks.index(
                                    tracker.task
                                )
                                yield ThreadItemUpdated(
                                    item_id=ctx.workflow_item.id,
                                    update=WorkflowTaskUpdated(
                                        task=tracker.task,
                                        task_index=task_index,
                                    ),
                                )
                continue

            if event.type != "raw_response_event":
                # Ignore everything else that isn't a raw response event
                continue

            # Handle Responses events
            event = event.data
            if event.type == "response.content_part.added":
                if event.part.type == "reasoning_text":
                    continue
                content = _convert_content(event.part)
                yield ThreadItemUpdated(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartAdded(
                        content_index=event.content_index,
                        content=content,
                    ),
                )
            elif event.type == "response.output_text.delta":
                yield ThreadItemUpdated(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartTextDelta(
                        content_index=event.content_index,
                        delta=event.delta,
                    ),
                )
            elif event.type == "response.output_text.done":
                yield ThreadItemUpdated(
                    item_id=event.item_id,
                    update=AssistantMessageContentPartDone(
                        content_index=event.content_index,
                        content=AssistantMessageContent(
                            text=event.text,
                            annotations=[],
                        ),
                    ),
                )
            elif event.type == "response.output_text.annotation.added":
                # Ignore annotation-added events; annotations are reflected in the final item content.
                continue
            elif event.type == "response.output_item.added":
                item = event.item
                if item.type == "reasoning" and not ctx.workflow_item:
                    for workflow_event in ensure_workflow():
                        yield workflow_event
                    # Store the reasoning ID to associate with the next message
                    current_reasoning_id = item.id
                if item.type == "message":
                    if ctx.workflow_item:
                        yield end_workflow(ctx.workflow_item)
                    produced_items.add(item.id)
                    yield ThreadItemAddedEvent(
                        item=AssistantMessageItem(
                            # Reusing the Responses message ID
                            id=item.id,
                            thread_id=thread.id,
                            content=[_convert_content(c) for c in item.content],
                            created_at=datetime.now(),
                            reasoning_id=current_reasoning_id,
                        ),
                    )
                    # Reset the reasoning_id after associating it with the message
                    current_reasoning_id = None
                elif item.type == "function_call":
                    tracker, task_added, workflow_events = ensure_function_task(
                        item.id,
                        name=getattr(item, "name", None),
                        call_id=getattr(item, "call_id", None),
                    )
                    updated = apply_function_task_updates(
                        tracker,
                        status=getattr(item, "status", None),
                        arguments=getattr(item, "arguments", None),
                        name=getattr(item, "name", None),
                    )
                    for workflow_event in workflow_events:
                        yield workflow_event
                    if ctx.workflow_item and (task_added or updated):
                        task_index = ctx.workflow_item.workflow.tasks.index(
                            tracker.task
                        )
                        update_cls = (
                            WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                        )
                        yield ThreadItemUpdated(
                            item_id=ctx.workflow_item.id,
                            update=update_cls(
                                task=tracker.task,
                                task_index=task_index,
                            ),
                        )
                    produced_items.add(item.id)
                elif item.type == "function_call_output":
                    tracker = get_function_task_by_call_id(
                        getattr(item, "call_id", None)
                    )
                    if tracker:
                        updated = apply_function_task_updates(
                            tracker,
                            output=getattr(item, "output", None),
                            status=getattr(item, "status", None),
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                elif item.type == "computer_call":
                    tracker, task_added, workflow_events = ensure_computer_task(
                        item.id,
                        call_id=getattr(item, "call_id", None),
                    )
                    updated = apply_computer_call_updates(
                        tracker,
                        cast(ResponseComputerToolCall, item),
                    )
                    for workflow_event in workflow_events:
                        yield workflow_event
                    if ctx.workflow_item and (task_added or updated):
                        task_index = ctx.workflow_item.workflow.tasks.index(
                            tracker.task
                        )
                        update_cls = (
                            WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                        )
                        yield ThreadItemUpdated(
                            item_id=ctx.workflow_item.id,
                            update=update_cls(
                                task=tracker.task,
                                task_index=task_index,
                            ),
                        )
                    produced_items.add(item.id)
                elif item.type == "computer_call_output":
                    tracker = get_computer_task_by_call_id(
                        getattr(item, "call_id", None)
                    )
                    if tracker:
                        updated = apply_computer_output_updates(
                            tracker,
                            call_id=getattr(item, "call_id", None),
                            status=getattr(item, "status", None),
                            raw_output=getattr(item, "output", None),
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                elif item.type == "web_search_call":
                    for search_event in upsert_search_task(
                        cast(ResponseFunctionWebSearch, item)
                    ):
                        yield search_event
                elif item.type == "image_generation_call":
                    tracker, task_added, workflow_events = ensure_image_task(
                        item.id, event.output_index
                    )
                    tracker.task.call_id = item.id
                    tracker.task.output_index = event.output_index
                    status = "complete" if item.status == "completed" else "loading"
                    payload_b64, payload_url, payload_format = _extract_image_payload(
                        getattr(item, "result", None),
                        output_index=event.output_index,
                    )
                    updated = apply_image_task_updates(
                        tracker,
                        status=status,
                        final_b64=payload_b64 if status == "complete" else None,
                        final_url=payload_url if status == "complete" else None,
                        partial_b64=payload_b64 if status != "complete" else None,
                        partial_url=payload_url if status != "complete" else None,
                        output_format=payload_format,
                    )
                    for workflow_event in workflow_events:
                        yield workflow_event
                    if ctx.workflow_item and (task_added or updated):
                        task_index = ctx.workflow_item.workflow.tasks.index(
                            tracker.task
                        )
                        update_cls = (
                            WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                        )
                        yield ThreadItemUpdated(
                            item_id=ctx.workflow_item.id,
                            update=update_cls(
                                task=tracker.task,
                                task_index=task_index,
                            ),
                        )
                    produced_items.add(item.id)
            elif event.type == "response.image_generation_call.in_progress":
                tracker, task_added, workflow_events = ensure_image_task(
                    event.item_id, event.output_index
                )
                updated = apply_image_task_updates(tracker, status="loading")
                for workflow_event in workflow_events:
                    yield workflow_event
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.image_generation_call.generating":
                tracker, task_added, workflow_events = ensure_image_task(
                    event.item_id, event.output_index
                )
                updated = apply_image_task_updates(tracker, status="loading")
                for workflow_event in workflow_events:
                    yield workflow_event
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.image_generation_call.partial_image":
                tracker, task_added, workflow_events = ensure_image_task(
                    event.item_id, event.output_index
                )
                raw_partial_b64 = _coerce_optional_str(
                    _event_attr(event, "partial_image_b64")
                )
                raw_partial_url = _coerce_optional_str(
                    _event_attr(event, "partial_image_url")
                )
                payload = _event_attr(event, "partial_image") or _event_attr(
                    event, "image"
                )
                payload_b64, payload_url, payload_format = _extract_image_payload(
                    payload, output_index=event.output_index
                )
                if raw_partial_b64 is None:
                    raw_partial_b64 = payload_b64
                if raw_partial_url is None:
                    raw_partial_url = payload_url
                updated = apply_image_task_updates(
                    tracker,
                    status="loading",
                    partial_b64=raw_partial_b64,
                    partial_url=raw_partial_url,
                    output_format=payload_format,
                )
                for workflow_event in workflow_events:
                    yield workflow_event
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.image_generation_call.completed":
                tracker, task_added, workflow_events = ensure_image_task(
                    event.item_id, event.output_index
                )
                complete_b64, complete_url, complete_format = _extract_image_payload(
                    _event_attr(event, "image") or _event_attr(event, "result"),
                    output_index=event.output_index,
                )
                updated = apply_image_task_updates(
                    tracker,
                    status="complete",
                    final_b64=complete_b64,
                    final_url=complete_url,
                    output_format=complete_format,
                )
                for workflow_event in workflow_events:
                    yield workflow_event
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.reasoning_summary_text.delta":
                if not ctx.workflow_item:
                    continue

                # stream the first thought in a new workflow so that we can show it earlier
                if (
                    ctx.workflow_item.workflow.type == "reasoning"
                    and len(ctx.workflow_item.workflow.tasks) == 0
                ):
                    streaming_thought = StreamingThoughtTracker(
                        item_id=event.item_id,
                        index=event.summary_index,
                        task=ThoughtTask(content=event.delta),
                    )
                    ctx.workflow_item.workflow.tasks.append(streaming_thought.task)
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskAdded(
                            task=streaming_thought.task,
                            task_index=0,
                        ),
                    )
                elif (
                    streaming_thought
                    and streaming_thought.task in ctx.workflow_item.workflow.tasks
                    and event.item_id == streaming_thought.item_id
                    and event.summary_index == streaming_thought.index
                ):
                    streaming_thought.task.content += event.delta
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=WorkflowTaskUpdated(
                            task=streaming_thought.task,
                            task_index=ctx.workflow_item.workflow.tasks.index(
                                streaming_thought.task
                            ),
                        ),
                    )
            elif event.type == "response.reasoning_summary_text.done":
                if ctx.workflow_item:
                    if (
                        streaming_thought
                        and streaming_thought.task in ctx.workflow_item.workflow.tasks
                        and event.item_id == streaming_thought.item_id
                        and event.summary_index == streaming_thought.index
                    ):
                        task = streaming_thought.task
                        task.content = event.text
                        streaming_thought = None
                        update = WorkflowTaskUpdated(
                            task=task,
                            task_index=ctx.workflow_item.workflow.tasks.index(task),
                        )
                    else:
                        task = ThoughtTask(content=event.text)
                        ctx.workflow_item.workflow.tasks.append(task)
                        update = WorkflowTaskAdded(
                            task=task,
                            task_index=ctx.workflow_item.workflow.tasks.index(task),
                        )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update,
                    )
            elif event.type == "response.function_call_arguments.delta":
                tracker, task_added, workflow_events = ensure_function_task(event.item_id)
                for workflow_event in workflow_events:
                    yield workflow_event
                updated = apply_function_task_updates(
                    tracker,
                    arguments_delta=event.delta,
                )
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.function_call_arguments.done":
                tracker, task_added, workflow_events = ensure_function_task(
                    event.item_id,
                    name=getattr(event, "name", None),
                )
                for workflow_event in workflow_events:
                    yield workflow_event
                updated = apply_function_task_updates(
                    tracker,
                    arguments=event.arguments,
                    name=getattr(event, "name", None),
                )
                if ctx.workflow_item and (task_added or updated):
                    task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                    update_cls = (
                        WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                    )
                    yield ThreadItemUpdated(
                        item_id=ctx.workflow_item.id,
                        update=update_cls(
                            task=tracker.task,
                            task_index=task_index,
                        ),
                    )
            elif event.type == "response.output_item.done":
                item = event.item
                if item.type == "message":
                    produced_items.add(item.id)
                    yield ThreadItemDoneEvent(
                        item=AssistantMessageItem(
                            # Reusing the Responses message ID
                            id=item.id,
                            thread_id=thread.id,
                            content=[_convert_content(c) for c in item.content],
                            created_at=datetime.now(),
                        ),
                    )
                elif item.type == "function_call":
                    tracker, task_added, workflow_events = ensure_function_task(
                        item.id,
                        name=getattr(item, "name", None),
                        call_id=getattr(item, "call_id", None),
                    )
                    for workflow_event in workflow_events:
                        yield workflow_event
                    updated = apply_function_task_updates(
                        tracker,
                        status=getattr(item, "status", None),
                        arguments=getattr(item, "arguments", None),
                        name=getattr(item, "name", None),
                    )
                    if ctx.workflow_item and (task_added or updated):
                        task_index = ctx.workflow_item.workflow.tasks.index(tracker.task)
                        update_cls = (
                            WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                        )
                        yield ThreadItemUpdated(
                            item_id=ctx.workflow_item.id,
                            update=update_cls(
                                task=tracker.task,
                                task_index=task_index,
                            ),
                        )
                elif item.type == "function_call_output":
                    tracker = get_function_task_by_call_id(
                        getattr(item, "call_id", None)
                    )
                    if tracker:
                        updated = apply_function_task_updates(
                            tracker,
                            output=getattr(item, "output", None),
                            status=getattr(item, "status", None),
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                elif item.type == "computer_call":
                    tracker, task_added, workflow_events = ensure_computer_task(
                        item.id,
                        call_id=getattr(item, "call_id", None),
                    )
                    for workflow_event in workflow_events:
                        yield workflow_event
                    updated = apply_computer_call_updates(
                        tracker,
                        cast(ResponseComputerToolCall, item),
                    )
                    if ctx.workflow_item and (task_added or updated):
                        task_index = ctx.workflow_item.workflow.tasks.index(
                            tracker.task
                        )
                        update_cls = (
                            WorkflowTaskAdded if task_added else WorkflowTaskUpdated
                        )
                        yield ThreadItemUpdated(
                            item_id=ctx.workflow_item.id,
                            update=update_cls(
                                task=tracker.task,
                                task_index=task_index,
                            ),
                        )
                    produced_items.add(item.id)
                elif item.type == "computer_call_output":
                    tracker = get_computer_task_by_call_id(
                        getattr(item, "call_id", None)
                    )
                    if tracker:
                        updated = apply_computer_output_updates(
                            tracker,
                            call_id=getattr(item, "call_id", None),
                            status=getattr(item, "status", None),
                            raw_output=getattr(item, "output", None),
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
                elif item.type == "web_search_call":
                    for search_event in upsert_search_task(
                        cast(ResponseFunctionWebSearch, item), status="complete"
                    ):
                        yield search_event
                elif item.type == "image_generation_call":
                    tracker = image_tasks.get((item.id, event.output_index))
                    if tracker is not None:
                        final_b64: str | None = None
                        final_url: str | None = None
                        output_format: str | None = None
                        raw_result = getattr(item, "result", None)
                        if isinstance(raw_result, str):
                            candidate = _coerce_optional_str(raw_result)
                            if candidate:
                                if candidate.startswith("data:") or "://" in candidate:
                                    final_url = candidate
                                else:
                                    final_b64 = candidate
                        else:
                            final_b64, final_url, output_format = _extract_image_payload(
                                raw_result,
                                output_index=event.output_index,
                            )
                        updated = apply_image_task_updates(
                            tracker,
                            status="complete",
                            final_b64=final_b64,
                            final_url=final_url,
                            output_format=output_format,
                        )
                        if ctx.workflow_item and updated:
                            task_index = ctx.workflow_item.workflow.tasks.index(
                                tracker.task
                            )
                            yield ThreadItemUpdated(
                                item_id=ctx.workflow_item.id,
                                update=WorkflowTaskUpdated(
                                    task=tracker.task,
                                    task_index=task_index,
                                ),
                            )
            elif event.type == "response.web_search_call.in_progress":
                for search_event in update_search_task_status(
                    event.item_id, "loading"
                ):
                    yield search_event
            elif event.type == "response.web_search_call.searching":
                for search_event in update_search_task_status(
                    event.item_id, "loading"
                ):
                    yield search_event
            elif event.type == "response.web_search_call.completed":
                for search_event in update_search_task_status(
                    event.item_id, "complete"
                ):
                    yield search_event

    except (InputGuardrailTripwireTriggered, OutputGuardrailTripwireTriggered):
        for item_id in produced_items:
            yield ThreadItemRemovedEvent(item_id=item_id)

        # Drain remaining events without processing them
        context._complete()
        queue_iterator.drain_and_complete()
        image_tasks.clear()
        search_tasks.clear()
        function_tasks.clear()
        function_tasks_by_call_id.clear()

        raise

    context._complete()

    # Drain remaining events
    async for event in queue_iterator:
        yield event.event

    # If there is still an active workflow at the end of the run, store
    # it's current state so that we can continue it in the next turn.
    if ctx.workflow_item:
        await ctx.store.add_thread_item(
            thread.id, ctx.workflow_item, ctx.request_context
        )

    if context.client_tool_call:
        yield ThreadItemDoneEvent(
            item=ClientToolCallItem(
                id=current_item_id
                or context.store.generate_item_id(
                    "tool_call", thread, context.request_context
                ),
                thread_id=thread.id,
                name=context.client_tool_call.name,
                arguments=context.client_tool_call.arguments,
                created_at=datetime.now(),
                call_id=current_tool_call
                or context.store.generate_item_id(
                    "tool_call", thread, context.request_context
                ),
            ),
        )


TWidget = TypeVar("TWidget", bound=Markdown | Text)


async def accumulate_text(
    events: AsyncIterator[StreamEvent],
    base_widget: TWidget,
) -> AsyncIterator[TWidget]:
    text = ""
    yield base_widget
    async for event in events:
        if event.type == "raw_response_event":
            if event.data.type == "response.output_text.delta":
                text += event.data.delta
                yield base_widget.model_copy(update={"value": text})
    yield base_widget.model_copy(update={"value": text, "streaming": False})


class ThreadItemConverter:
    """
    Converts thread items to Agent SDK input items.
    Widgets, Tasks, and Workflows have default conversions but can be customized.
    Attachments, Tags, and HiddenContextItems require custom handling based on the use case.
    Other item types are converted automatically.
    """

    def attachment_to_message_content(
        self, attachment: Attachment
    ) -> Awaitable[ResponseInputContentParam]:
        """
        Convert an attachment in a user message into a message content part to send to the model.
        Required when attachments are enabled.
        """
        raise NotImplementedError(
            "An Attachment was included in a UserMessageItem but Converter.attachment_to_message_content was not implemented"
        )

    def tag_to_message_content(
        self, tag: UserMessageTagContent
    ) -> ResponseInputContentParam:
        """
        Convert a tag in a user message into a message content part to send to the model as context.
        Required when tags are used.
        """
        raise NotImplementedError(
            "A Tag was included in a UserMessageItem but Converter.tag_to_message_content is not implemented"
        )

    def hidden_context_to_input(
        self, item: HiddenContextItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convert a HiddenContextItem into input item(s) to send to the model.
        Required when HiddenContextItem are used.
        """
        raise NotImplementedError(
            "HiddenContextItem were present in a user message but Converter.hidden_context_to_input was not implemented"
        )

    def task_to_input(
        self, item: TaskItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convert a TaskItem into input item(s) to send to the model.
        """
        if item.task.type != "custom" or (
            not item.task.title and not item.task.content
        ):
            return None
        title = f"{item.task.title}" if item.task.title else ""
        content = f"{item.task.content}" if item.task.content else ""
        task_text = f"{title}: {content}" if title and content else title or content
        text = f"A message was displayed to the user that the following task was performed:\n<Task>\n{task_text}\n</Task>"
        return Message(
            type="message",
            content=[
                ResponseInputTextParam(
                    type="input_text",
                    text=text,
                )
            ],
            role="user",
        )

    def workflow_to_input(
        self, item: WorkflowItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convert a TaskItem into input item(s) to send to the model.
        Returns WorkflowItem.response_items by default.
        """
        messages = []
        for task in item.workflow.tasks:
            if task.type != "custom" or (not task.title and not task.content):
                continue

            title = f"{task.title}" if task.title else ""
            content = f"{task.content}" if task.content else ""
            task_text = f"{title}: {content}" if title and content else title or content
            text = f"A message was displayed to the user that the following task was performed:\n<Task>\n{task_text}\n</Task>"
            messages.append(
                Message(
                    type="message",
                    content=[
                        ResponseInputTextParam(
                            type="input_text",
                            text=text,
                        )
                    ],
                    role="user",
                )
            )
        return messages

    def widget_to_input(
        self, item: WidgetItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        """
        Convert a WidgetItem into input item(s) to send to the model.
        By default, WidgetItems converted to a text description with a JSON representation of the widget.
        """
        return Message(
            type="message",
            content=[
                ResponseInputTextParam(
                    type="input_text",
                    text=f"The following graphical UI widget (id: {item.id}) was displayed to the user:"
                    + item.widget.model_dump_json(
                        exclude_unset=True, exclude_none=True
                    ),
                )
            ],
            role="user",
        )

    async def user_message_to_input(
        self, item: UserMessageItem, is_last_message: bool = True
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        # Build the user text exactly as typed, rendering tags as @key
        message_text_parts: list[str] = []
        # Track tags separately to add system context
        raw_tags: list[UserMessageTagContent] = []

        for part in item.content:
            if isinstance(part, UserMessageTextContent):
                message_text_parts.append(part.text)
            elif isinstance(part, UserMessageTagContent):
                message_text_parts.append(f"@{part.text}")
                raw_tags.append(part)
            else:
                assert_never(part)

        user_text_item = Message(
            role="user",
            type="message",
            content=[
                ResponseInputTextParam(
                    type="input_text", text="".join(message_text_parts)
                ),
                *[
                    await self.attachment_to_message_content(a)
                    for a in item.attachments
                ],
            ],
        )

        # Build system items (prepend later): quoted text and @-mention context
        context_items: list[TResponseInputItem] = []

        if item.quoted_text and is_last_message:
            context_items.append(
                Message(
                    role="user",
                    type="message",
                    content=[
                        ResponseInputTextParam(
                            type="input_text",
                            text=f"The user is referring to this in particular: \n{item.quoted_text}",
                        )
                    ],
                )
            )

        # Dedupe tags (preserve order) and resolve to message content
        if raw_tags:
            seen, uniq_tags = set(), []
            for t in raw_tags:
                if t.text not in seen:
                    seen.add(t.text)
                    uniq_tags.append(t)

            tag_content: ResponseInputMessageContentListParam = [
                # should return summarized text items
                self.tag_to_message_content(tag)
                for tag in uniq_tags
            ]

            if tag_content:
                context_items.append(
                    Message(
                        role="user",
                        type="message",
                        content=[
                            ResponseInputTextParam(
                                type="input_text",
                                text=cleandoc("""
                                    # User-provided context for @-mentions
                                    - When referencing resolved entities, use their canonical names **without** '@'.
                                    - The '@' form appears only in user text and should not be echoed.
                                """).strip(),
                            ),
                            *tag_content,
                        ],
                    )
                )

        return [user_text_item, *context_items]

    async def assistant_message_to_input(
        self, item: AssistantMessageItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        message_param = EasyInputMessageParam(
            type="message",
            content=[
                # content param doesn't support the assistant message content types
                cast(
                    ResponseInputContentParam,
                    ResponseOutputText(
                        type="output_text",
                        text=c.text,
                        annotations=[],  # TODO: these should be sent back as well
                    ).model_dump(),
                )
                for c in item.content
            ],
            role="assistant",
        )

        # If this message has an associated reasoning item, include it before the message
        if item.reasoning_id:
            reasoning_item = ResponseReasoningItem(
                id=item.reasoning_id,
                type="reasoning",
                summary=[],  # Empty summary as we're just maintaining the relationship
            )
            return [reasoning_item, message_param]

        return message_param

    async def client_tool_call_to_input(
        self, item: ClientToolCallItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        if item.status == "pending":
            # Filter out pending tool calls - they cannot be sent to the model
            return None

        return [
            ResponseFunctionToolCallParam(
                type="function_call",
                call_id=item.call_id,
                name=item.name,
                arguments=json.dumps(item.arguments),
            ),
            FunctionCallOutput(
                type="function_call_output",
                call_id=item.call_id,
                output=json.dumps(item.output),
            ),
        ]

    async def end_of_turn_to_input(
        self, item: EndOfTurnItem
    ) -> TResponseInputItem | list[TResponseInputItem] | None:
        # Only used for UI hints - you shouldn't need to override this
        return None

    async def _thread_item_to_input_item(
        self,
        item: ThreadItem,
        is_last_message: bool = True,
    ) -> list[TResponseInputItem]:
        match item:
            case UserMessageItem():
                out = await self.user_message_to_input(item, is_last_message) or []
                return out if isinstance(out, list) else [out]
            case AssistantMessageItem():
                out = await self.assistant_message_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case ClientToolCallItem():
                out = await self.client_tool_call_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case EndOfTurnItem():
                out = await self.end_of_turn_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case WidgetItem():
                out = self.widget_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case WorkflowItem():
                out = self.workflow_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case TaskItem():
                out = self.task_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case HiddenContextItem():
                out = self.hidden_context_to_input(item) or []
                return out if isinstance(out, list) else [out]
            case _:
                assert_never(item)

    async def to_agent_input(
        self,
        thread_items: Sequence[ThreadItem] | ThreadItem,
    ) -> list[TResponseInputItem]:
        if isinstance(thread_items, Sequence):
            # shallow copy in case caller mutates the list while we're iterating
            thread_items = thread_items[:]
        else:
            thread_items = [thread_items]
        output: list[TResponseInputItem] = []
        for item in thread_items:
            output.extend(
                await self._thread_item_to_input_item(
                    item,
                    is_last_message=item is thread_items[-1],
                )
            )
        return output


_DEFAULT_CONVERTER = ThreadItemConverter()


def simple_to_agent_input(thread_items: Sequence[ThreadItem] | ThreadItem):
    return _DEFAULT_CONVERTER.to_agent_input(thread_items)
