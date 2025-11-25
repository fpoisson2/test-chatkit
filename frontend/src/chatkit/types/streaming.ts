/**
 * Types pour les événements de streaming ChatKit
 */

import type { WidgetComponent, WidgetRoot } from './widgets';
import type {
  AssistantMessageContent,
  AssistantMessageItem,
  Annotation,
  Task,
} from './messages';
import type { Thread, ThreadItem } from './threads';

// ===== Types de base pour les événements =====

export interface ThreadStreamEventBase {
  type: string;
  event_id: string;
}

// ===== Événements de thread principaux =====

export interface ThreadCreatedEvent extends ThreadStreamEventBase {
  type: 'thread.created';
  thread: Thread;
}

export interface ThreadUpdatedEvent extends ThreadStreamEventBase {
  type: 'thread.updated';
  thread: Thread;
}

// ===== Événements d'items de thread =====

export interface ThreadItemAddedEvent extends ThreadStreamEventBase {
  type: 'thread.item.added';
  item: ThreadItem;
}

export interface ThreadItemDoneEvent extends ThreadStreamEventBase {
  type: 'thread.item.done';
  item: ThreadItem;
}

export interface ThreadItemRemovedEvent extends ThreadStreamEventBase {
  type: 'thread.item.removed';
  item_id: string;
}

export interface ThreadItemReplacedEvent extends ThreadStreamEventBase {
  type: 'thread.item.replaced';
  item: ThreadItem;
}

// ===== Événements de contenu assistant (granulaires) =====

export interface AssistantMessageContentPartAddedEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.added';
  item_id: string;
  content_index: number;
  content: AssistantMessageContent;
}

export interface AssistantMessageContentPartTextDeltaEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.text_delta';
  item_id: string;
  content_index: number;
  delta: string;
}

export interface AssistantMessageContentPartAnnotationAddedEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.annotation_added';
  item_id: string;
  content_index: number;
  annotation_index: number;
  annotation: Annotation;
}

export interface AssistantMessageContentPartDoneEvent extends ThreadStreamEventBase {
  type: 'assistant_message.content_part.done';
  item_id: string;
  content_index: number;
  content: AssistantMessageContent;
}

// ===== Événements de workflow =====

export interface WorkflowTaskAddedEvent extends ThreadStreamEventBase {
  type: 'workflow.task.added';
  item_id: string;
  task_index: number;
  task: Task;
}

export interface WorkflowTaskUpdatedEvent extends ThreadStreamEventBase {
  type: 'workflow.task.updated';
  item_id: string;
  task_index: number;
  task: Task;
}

// ===== Événements de widget =====

export interface WidgetRootUpdatedEvent extends ThreadStreamEventBase {
  type: 'widget.root.updated';
  item_id: string;
  widget: WidgetRoot;
}

export interface WidgetComponentUpdatedEvent extends ThreadStreamEventBase {
  type: 'widget.component.updated';
  item_id: string;
  component_id: string;
  component: WidgetComponent;
}

export interface WidgetStreamingTextValueDeltaEvent extends ThreadStreamEventBase {
  type: 'widget.streaming_text.value_delta';
  item_id: string;
  component_id: string;
  delta: string;
  done: boolean;
}

// ===== Union des types d'updates d'items =====

export type ThreadItemUpdate =
  | AssistantMessageContentPartAddedEvent
  | AssistantMessageContentPartTextDeltaEvent
  | AssistantMessageContentPartAnnotationAddedEvent
  | AssistantMessageContentPartDoneEvent
  | WidgetStreamingTextValueDeltaEvent
  | WidgetComponentUpdatedEvent
  | WidgetRootUpdatedEvent
  | WorkflowTaskAddedEvent
  | WorkflowTaskUpdatedEvent;

export interface ThreadItemUpdatedEvent extends ThreadStreamEventBase {
  type: 'thread.item.updated';
  item_id: string;
  update: ThreadItemUpdate;
}

// ===== Événements UI/UX =====

export interface ProgressUpdateEvent extends ThreadStreamEventBase {
  type: 'progress_update';
  icon?: string;
  text: string;
}

export interface NoticeEvent extends ThreadStreamEventBase {
  type: 'notice';
  level: 'info' | 'warning' | 'danger';
  message: string;
  title?: string;
}

// ===== Événements d'erreur =====

export interface ErrorEvent extends ThreadStreamEventBase {
  type: 'error';
  code: string;
  message: string;
  allow_retry?: boolean;
}

// ===== LEGACY: événements conservés pour compatibilité mais deprecated =====

export interface ThreadItemCreatedEvent extends ThreadStreamEventBase {
  type: 'thread.item.created';
  item: ThreadItem;
}

export interface ThreadItemDeltaEvent extends ThreadStreamEventBase {
  type: 'thread.item.delta';
  delta: {
    item_id: string;
    content_index: number;
    type: 'text' | 'widget';
    text?: string;
    widget?: Partial<WidgetRoot>;
  };
}

export interface ThreadItemCompletedEvent extends ThreadStreamEventBase {
  type: 'thread.item.completed';
  item: ThreadItem;
}

export interface ThreadMessageCompletedEvent extends ThreadStreamEventBase {
  type: 'thread.message.completed';
  message: AssistantMessageItem;
}

// ===== Union de tous les événements de streaming =====

export type ThreadStreamEvent =
  | ThreadCreatedEvent
  | ThreadUpdatedEvent
  | ThreadItemAddedEvent
  | ThreadItemDoneEvent
  | ThreadItemUpdatedEvent
  | ThreadItemRemovedEvent
  | ThreadItemReplacedEvent
  | ProgressUpdateEvent
  | ErrorEvent
  | NoticeEvent
  // Legacy events (conservés pour compatibilité)
  | ThreadItemCreatedEvent
  | ThreadItemDeltaEvent
  | ThreadItemCompletedEvent
  | ThreadMessageCompletedEvent
  // Les events individuels sont aussi exportés directement
  | AssistantMessageContentPartAddedEvent
  | AssistantMessageContentPartTextDeltaEvent
  | AssistantMessageContentPartAnnotationAddedEvent
  | AssistantMessageContentPartDoneEvent
  | WorkflowTaskAddedEvent
  | WorkflowTaskUpdatedEvent
  | WidgetRootUpdatedEvent
  | WidgetComponentUpdatedEvent
  | WidgetStreamingTextValueDeltaEvent;
