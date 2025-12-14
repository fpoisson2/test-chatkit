/**
 * Application des événements delta à un thread
 */
import type {
  Thread,
  ThreadStreamEvent,
  ThreadItem,
  AssistantMessageItem,
} from '../../types';
import {
  normalizeThreadItems,
  normalizeThreadItemsWithFallback,
} from './normalizers';

/**
 * Met à jour un composant widget de manière récursive par son ID
 */
function updateWidgetComponent(
  components: any[],
  componentId: string,
  updater: (comp: any) => any
): any[] {
  return components.map((comp) => {
    if (comp.id === componentId) {
      return updater(comp);
    }
    if (comp.children) {
      return { ...comp, children: updateWidgetComponent(comp.children, componentId, updater) };
    }
    return comp;
  });
}

/**
 * Applique un événement de création de thread
 */
function handleThreadCreated(event: Extract<ThreadStreamEvent, { type: 'thread.created' }>): Thread {
  return {
    ...event.thread,
    items: normalizeThreadItems(event.thread.items),
  };
}

/**
 * Applique un événement de mise à jour de thread
 */
function handleThreadUpdated(
  thread: Thread,
  event: Extract<ThreadStreamEvent, { type: 'thread.updated' }>
): Thread {
  const newItems = normalizeThreadItemsWithFallback(event.thread.items, thread.items);
  console.log('[deltas] handleThreadUpdated:', {
    threadId: event.thread.id,
    previousItemCount: thread.items.length,
    newItemCount: newItems.length,
    eventItemCount: Array.isArray(event.thread.items) ? event.thread.items.length : 'N/A',
  });
  return {
    ...event.thread,
    items: newItems,
  };
}

/**
 * Applique un événement d'ajout d'item
 */
function handleItemAdded(
  thread: Thread,
  item: ThreadItem
): Thread {
  const exists = thread.items.find((i) => i.id === item.id);
  if (exists) {
    console.log('[deltas] handleItemAdded: item already exists, skipping', { itemId: item.id, type: item.type });
    return thread;
  }

  console.log('[deltas] handleItemAdded: adding new item', { itemId: item.id, type: item.type, currentCount: thread.items.length });
  return {
    ...thread,
    items: [...thread.items, item],
  };
}

/**
 * Applique un événement de suppression d'item
 */
function handleItemRemoved(thread: Thread, itemId: string): Thread {
  return {
    ...thread,
    items: thread.items.filter((item) => item.id !== itemId),
  };
}

/**
 * Applique un événement de remplacement d'item
 */
function handleItemReplaced(thread: Thread, newItem: ThreadItem): Thread {
  return {
    ...thread,
    items: thread.items.map((item) => (item.id === newItem.id ? newItem : item)),
  };
}

/**
 * Applique un événement thread.item.delta (ancien format)
 */
function handleItemDelta(
  thread: Thread,
  delta: {
    item_id: string;
    content_index: number;
    type: string;
    text?: string;
    widget?: any;
  }
): Thread {
  const { item_id, content_index, type, text, widget } = delta;

  const items = thread.items.map((item) => {
    if (item.id !== item_id) {
      return item;
    }

    const newContent = [...(item as AssistantMessageItem).content];

    // S'assurer que l'index existe
    while (newContent.length <= content_index) {
      newContent.push({
        type: type as 'text',
        text: '',
      } as any);
    }

    if (type === 'text' && text !== undefined) {
      const existing = newContent[content_index];
      if (existing.type === 'text') {
        newContent[content_index] = {
          ...existing,
          text: (existing.text || '') + text,
        };
      }
    } else if (type === 'widget' && widget !== undefined) {
      const existing = newContent[content_index];
      if (existing && existing.type === 'widget') {
        newContent[content_index] = {
          ...existing,
          widget: {
            ...existing.widget,
            ...widget,
          },
        };
      } else {
        newContent[content_index] = {
          type: 'widget',
          widget: widget as any,
        };
      }
    }

    return {
      ...item,
      content: newContent,
    };
  });

  return {
    ...thread,
    items,
  };
}

/**
 * Applique un événement thread.item.completed (LEGACY)
 */
function handleItemCompleted(
  thread: Thread,
  completedItem: ThreadItem
): Thread {
  const existingIndex = thread.items.findIndex((item) => item.id === completedItem.id);

  if (existingIndex === -1) {
    console.log('[deltas] handleItemCompleted: item NOT found, adding new', { itemId: completedItem.id, type: completedItem.type, currentCount: thread.items.length });
    return {
      ...thread,
      items: [...thread.items, completedItem],
    };
  }

  console.log('[deltas] handleItemCompleted: updating existing item', { itemId: completedItem.id, type: completedItem.type, existingIndex });
  const items = thread.items.map((item, idx) => {
    if (idx !== existingIndex) {
      return item;
    }

    return {
      ...item,
      ...completedItem,
      content: completedItem.content ?? (item as AssistantMessageItem).content,
    };
  });

  return {
    ...thread,
    items,
  };
}

/**
 * Applique un événement thread.item.done
 */
function handleItemDone(
  thread: Thread,
  doneItem: ThreadItem
): Thread {
  let completedItem = doneItem;

  // Mark workflow as completed if applicable
  if (doneItem.type === 'workflow') {
    completedItem = {
      ...doneItem,
      workflow: {
        ...doneItem.workflow,
        completed: true,
      },
    };
  }

  const existingIndex = thread.items.findIndex((item) => item.id === doneItem.id);

  if (existingIndex === -1) {
    console.log('[deltas] handleItemDone: item NOT found, adding new', { itemId: doneItem.id, type: doneItem.type, currentCount: thread.items.length });
    return {
      ...thread,
      items: [...thread.items, completedItem],
    };
  }

  console.log('[deltas] handleItemDone: updating existing item', { itemId: doneItem.id, type: doneItem.type, existingIndex });
  return {
    ...thread,
    items: thread.items.map((item) => (item.id === doneItem.id ? completedItem : item)),
  };
}

/**
 * Applique un événement workflow.task.added
 */
function handleWorkflowTaskAdded(
  thread: Thread,
  itemId: string,
  taskIndex: number,
  task: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'workflow') {
      const tasks = [...item.workflow.tasks];
      tasks.splice(taskIndex, 0, task);
      return {
        ...item,
        workflow: {
          ...item.workflow,
          tasks,
        },
      };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement workflow.task.updated
 */
function handleWorkflowTaskUpdated(
  thread: Thread,
  itemId: string,
  taskIndex: number,
  task: any
): Thread {
  // Debug logging
  if (task.type === 'computer_use') {
    console.log('[deltas] workflow.task.updated for computer_use:', {
      itemId,
      taskIndex,
      hasDebugToken: !!task.debug_url_token,
      status: task.status_indicator,
    });
  }

  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'workflow') {
      const tasks = [...item.workflow.tasks];
      tasks[taskIndex] = task;
      return {
        ...item,
        workflow: {
          ...item.workflow,
          tasks,
        },
      };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement widget.root.updated
 */
function handleWidgetRootUpdated(
  thread: Thread,
  itemId: string,
  widget: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'widget') {
      return { ...item, widget };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement widget.component.updated
 */
function handleWidgetComponentUpdated(
  thread: Thread,
  itemId: string,
  componentId: string,
  component: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'widget') {
      const updatedWidget = { ...item.widget };
      if (updatedWidget.children) {
        updatedWidget.children = updateWidgetComponent(
          updatedWidget.children,
          componentId,
          (comp) => ({ ...comp, ...component })
        );
      }
      return { ...item, widget: updatedWidget };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement widget.streaming_text.value_delta
 */
function handleWidgetStreamingTextDelta(
  thread: Thread,
  itemId: string,
  componentId: string,
  delta: string
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'widget') {
      const updatedWidget = { ...item.widget };
      if (updatedWidget.children) {
        updatedWidget.children = updateWidgetComponent(
          updatedWidget.children,
          componentId,
          (comp) => ({ ...comp, value: (comp.value || '') + delta })
        );
      }
      return { ...item, widget: updatedWidget };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement assistant_message.content_part.added
 */
function handleContentPartAdded(
  thread: Thread,
  itemId: string,
  contentIndex: number,
  content: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'assistant_message') {
      const newContent = [...item.content];
      while (newContent.length <= contentIndex) {
        newContent.push({ type: 'output_text' as const, text: '' });
      }
      newContent[contentIndex] = content;
      return { ...item, content: newContent };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement assistant_message.content_part.text_delta
 */
function handleContentPartTextDelta(
  thread: Thread,
  itemId: string,
  contentIndex: number,
  delta: string
): Thread {
  // Check if item exists, create placeholder if needed
  let itemExists = thread.items.some((item) => item.id === itemId);

  if (!itemExists && itemId.startsWith('__fake_id__')) {
    const newItem: AssistantMessageItem = {
      type: 'assistant_message',
      id: itemId,
      role: 'assistant',
      content: [],
      created_at: new Date().toISOString(),
    };

    thread = {
      ...thread,
      items: [...thread.items, newItem],
    };
  }

  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'assistant_message') {
      const newContent = [...item.content];

      while (newContent.length <= contentIndex) {
        newContent.push({ type: 'output_text', text: '' });
      }

      const existing = newContent[contentIndex];
      if (existing && existing.type === 'output_text') {
        newContent[contentIndex] = {
          ...existing,
          text: (existing.text || '') + delta,
        };
      } else {
        newContent[contentIndex] = {
          type: 'output_text',
          text: delta,
        };
      }

      return { ...item, content: newContent };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement assistant_message.content_part.annotation_added
 */
function handleContentPartAnnotationAdded(
  thread: Thread,
  itemId: string,
  contentIndex: number,
  annotationIndex: number,
  annotation: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'assistant_message') {
      const content = [...item.content];
      const existing = content[contentIndex];
      if (existing && existing.type === 'output_text') {
        const annotations = [...(existing.annotations || [])];
        while (annotations.length <= annotationIndex) {
          annotations.push(annotation);
        }
        annotations[annotationIndex] = annotation;
        content[contentIndex] = { ...existing, annotations };
      }
      return { ...item, content };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement assistant_message.content_part.done
 */
function handleContentPartDone(
  thread: Thread,
  itemId: string,
  contentIndex: number,
  content: any
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'assistant_message') {
      const newContent = [...item.content];
      newContent[contentIndex] = content;
      return { ...item, content: newContent };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement assistant_message.usage
 */
function handleUsageMetadata(
  thread: Thread,
  itemId: string,
  usage: { input_tokens: number; output_tokens: number; cost: number; model?: string }
): Thread {
  const items = thread.items.map((item) => {
    if (item.id === itemId && item.type === 'assistant_message') {
      return { ...item, usage_metadata: usage };
    }
    return item;
  });

  return { ...thread, items };
}

/**
 * Applique un événement delta à un thread
 */
export function applyDelta(thread: Thread, event: ThreadStreamEvent): Thread {
  // Handle wrapper events (thread.item.updated with nested 'update')
  if (event.type === 'thread.item.updated' && 'update' in event) {
    const wrappedEvent = event as any;
    const realEvent = {
      ...wrappedEvent.update,
      item_id: wrappedEvent.item_id,
    } as ThreadStreamEvent;
    return applyDelta(thread, realEvent);
  }

  switch (event.type) {
    case 'thread.created':
      return handleThreadCreated(event);

    case 'thread.updated':
      return handleThreadUpdated(thread, event);

    case 'thread.item.created':
    case 'thread.item.added':
      return handleItemAdded(thread, event.item);

    case 'thread.item.removed':
      return handleItemRemoved(thread, event.item_id);

    case 'thread.item.replaced':
      return handleItemReplaced(thread, event.item);

    case 'thread.item.delta':
      return handleItemDelta(thread, event.delta);

    case 'thread.item.completed':
      return handleItemCompleted(thread, event.item);

    case 'thread.item.done':
      return handleItemDone(thread, event.item);

    case 'thread.item.updated':
      return applyDelta(thread, event.update);

    case 'workflow.task.added':
      return handleWorkflowTaskAdded(thread, event.item_id, event.task_index, event.task);

    case 'workflow.task.updated':
      return handleWorkflowTaskUpdated(thread, event.item_id, event.task_index, event.task);

    case 'widget.root.updated':
      return handleWidgetRootUpdated(thread, event.item_id, event.widget);

    case 'widget.component.updated':
      return handleWidgetComponentUpdated(
        thread,
        event.item_id,
        event.component_id,
        event.component
      );

    case 'widget.streaming_text.value_delta':
      return handleWidgetStreamingTextDelta(
        thread,
        event.item_id,
        event.component_id,
        event.delta
      );

    case 'assistant_message.content_part.added':
      return handleContentPartAdded(thread, event.item_id, event.content_index, event.content);

    case 'assistant_message.content_part.text_delta':
      return handleContentPartTextDelta(thread, event.item_id, event.content_index, event.delta);

    case 'assistant_message.content_part.annotation_added':
      return handleContentPartAnnotationAdded(
        thread,
        event.item_id,
        event.content_index,
        event.annotation_index,
        event.annotation
      );

    case 'assistant_message.content_part.done':
      return handleContentPartDone(thread, event.item_id, event.content_index, event.content);

    case 'assistant_message.usage':
      return handleUsageMetadata(thread, event.item_id, event.usage);

    default:
      // Events like progress_update and notice don't modify the thread
      return thread;
  }
}
