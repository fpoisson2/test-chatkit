"""Utilities for applying incremental thread item updates."""

from __future__ import annotations

from collections.abc import Callable

from .types import (
    Annotation,
    AssistantMessageContent,
    AssistantMessageContentPartAdded,
    AssistantMessageContentPartAnnotationAdded,
    AssistantMessageContentPartDone,
    AssistantMessageContentPartTextDelta,
    AssistantMessageItem,
    ThreadItem,
    ThreadItemUpdate,
    WidgetComponent,
    WidgetComponentUpdated,
    WidgetItem,
    WidgetRoot,
    WidgetRootUpdated,
    WidgetStreamingTextValueDelta,
    WorkflowItem,
    WorkflowTaskAdded,
    WorkflowTaskUpdated,
)
from .widgets import Markdown, Text, WidgetComponentBase


def _ensure_assistant_item(item: ThreadItem) -> AssistantMessageItem:
    if not isinstance(item, AssistantMessageItem):
        raise TypeError(
            f"Thread item {getattr(item, 'id', '<unknown>')} is not an assistant message"
        )
    return item


def _ensure_workflow_item(item: ThreadItem) -> WorkflowItem:
    if not isinstance(item, WorkflowItem):
        raise TypeError(
            f"Thread item {getattr(item, 'id', '<unknown>')} is not a workflow"
        )
    return item


def _ensure_widget_item(item: ThreadItem) -> WidgetItem:
    if not isinstance(item, WidgetItem):
        raise TypeError(
            f"Thread item {getattr(item, 'id', '<unknown>')} is not a widget"
        )
    return item


def _replace_assistant_content(
    item: AssistantMessageItem,
    index: int,
    new_content: AssistantMessageContent,
) -> AssistantMessageItem:
    contents = list(item.content)
    if index < 0:
        raise IndexError("content_index cannot be negative")
    if index > len(contents):
        raise IndexError(
            f"content_index {index} is out of range for assistant message"
        )
    content_copy = new_content.model_copy(deep=True)
    if index == len(contents):
        contents.append(content_copy)
    else:
        contents[index] = content_copy
    return item.model_copy(update={"content": contents})


def _mutate_assistant_content(
    item: AssistantMessageItem,
    index: int,
    mutate: Callable[[AssistantMessageContent], AssistantMessageContent],
) -> AssistantMessageItem:
    contents = list(item.content)
    if index < 0 or index >= len(contents):
        raise IndexError(
            f"content_index {index} is out of range for assistant message"
        )
    existing = contents[index]
    if not isinstance(existing, AssistantMessageContent):
        raise TypeError("Assistant message content must be of type output_text")
    mutated = mutate(existing)
    contents[index] = mutated
    return item.model_copy(update={"content": contents})


def _update_widget_component(
    root: WidgetRoot,
    component_id: str,
    transform: Callable[[WidgetComponentBase], WidgetComponentBase],
) -> WidgetRoot:
    def visit(component: WidgetComponentBase) -> tuple[WidgetComponentBase, bool]:
        replaced = False
        if component.id == component_id:
            return transform(component), True

        if hasattr(component, "children"):
            children = component.children or []  # type: ignore[attr-defined]
            new_children: list[WidgetComponent] = []
            any_child_replaced = False
            for child in children:
                updated_child, child_replaced = visit(child)
                new_children.append(updated_child)
                any_child_replaced = any_child_replaced or child_replaced
            if any_child_replaced:
                component = component.model_copy(update={"children": new_children})
                replaced = True
        return component, replaced

    updated_root, replaced_flag = visit(root)
    if not replaced_flag:
        raise ValueError(f"Widget component {component_id} not found")
    return updated_root


def apply_thread_item_update(item: ThreadItem, update: ThreadItemUpdate) -> ThreadItem:
    """Apply ``ThreadItemUpdate`` to ``item`` and return the updated instance."""

    match update:
        case AssistantMessageContentPartAdded():
            assistant = _ensure_assistant_item(item)
            return _replace_assistant_content(assistant, update.content_index, update.content)
        case AssistantMessageContentPartTextDelta():
            assistant = _ensure_assistant_item(item)

            def mutate(content: AssistantMessageContent) -> AssistantMessageContent:
                new_text = content.text + update.delta
                return content.model_copy(update={"text": new_text})

            return _mutate_assistant_content(assistant, update.content_index, mutate)
        case AssistantMessageContentPartAnnotationAdded():
            assistant = _ensure_assistant_item(item)

            def mutate(content: AssistantMessageContent) -> AssistantMessageContent:
                annotations = list(content.annotations)
                annotation: Annotation = update.annotation.model_copy(deep=True)
                index = update.annotation_index
                if index < 0:
                    raise IndexError("annotation_index cannot be negative")
                if index > len(annotations):
                    raise IndexError(
                        f"annotation_index {index} is out of range for assistant message"
                    )
                if index == len(annotations):
                    annotations.append(annotation)
                else:
                    annotations[index] = annotation
                return content.model_copy(update={"annotations": annotations})

            return _mutate_assistant_content(assistant, update.content_index, mutate)
        case AssistantMessageContentPartDone():
            assistant = _ensure_assistant_item(item)
            return _replace_assistant_content(assistant, update.content_index, update.content)
        case WidgetStreamingTextValueDelta():
            widget_item = _ensure_widget_item(item)

            def transform(component: WidgetComponentBase) -> WidgetComponentBase:
                if not isinstance(component, (Markdown, Text)):
                    raise TypeError(
                        "Streaming text updates are only supported for Markdown/Text components"
                    )
                new_value = component.value + update.delta
                streaming = component.streaming
                if update.done:
                    streaming = False
                elif streaming is None:
                    streaming = True
                return component.model_copy(
                    update={"value": new_value, "streaming": streaming}
                )

            updated_root = _update_widget_component(
                widget_item.widget, update.component_id, transform
            )
            return widget_item.model_copy(update={"widget": updated_root})
        case WidgetComponentUpdated():
            widget_item = _ensure_widget_item(item)

            def transform(_: WidgetComponentBase) -> WidgetComponentBase:
                return update.component.model_copy(deep=True)

            updated_root = _update_widget_component(
                widget_item.widget, update.component_id, transform
            )
            return widget_item.model_copy(update={"widget": updated_root})
        case WidgetRootUpdated():
            widget_item = _ensure_widget_item(item)
            return widget_item.model_copy(update={"widget": update.widget.model_copy(deep=True)})
        case WorkflowTaskAdded():
            workflow_item = _ensure_workflow_item(item)
            tasks = list(workflow_item.workflow.tasks)
            index = max(0, min(update.task_index, len(tasks)))
            task_copy = update.task.model_copy(deep=True)
            tasks.insert(index, task_copy)
            workflow = workflow_item.workflow.model_copy(update={"tasks": tasks})
            return workflow_item.model_copy(update={"workflow": workflow})
        case WorkflowTaskUpdated():
            workflow_item = _ensure_workflow_item(item)
            tasks = list(workflow_item.workflow.tasks)
            if update.task_index < 0 or update.task_index >= len(tasks):
                raise IndexError(
                    f"task_index {update.task_index} is out of range for workflow"
                )
            tasks[update.task_index] = update.task.model_copy(deep=True)
            workflow = workflow_item.workflow.model_copy(update={"tasks": tasks})
            return workflow_item.model_copy(update={"workflow": workflow})
        case _:
            raise TypeError(f"Unsupported thread item update: {type(update)!r}")
