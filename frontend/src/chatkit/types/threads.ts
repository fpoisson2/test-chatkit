/**
 * Types pour les threads ChatKit
 */

import type { WidgetRoot } from './widgets';
import type {
  UserMessageItem,
  AssistantMessageItem,
  ClientToolCallItem,
  Task,
  Workflow,
} from './messages';

// ===== Types pour les items de thread =====

export interface WidgetItem {
  type: 'widget';
  id: string;
  created_at: string;
  widget: WidgetRoot;
  copy_text?: string;
}

export interface TaskItem {
  type: 'task';
  id: string;
  created_at: string;
  task: Task;
}

export interface WorkflowItem {
  type: 'workflow';
  id: string;
  created_at: string;
  workflow: Workflow;
}

export interface EndOfTurnItem {
  type: 'end_of_turn';
  id: string;
  created_at: string;
}

export type ThreadItem =
  | UserMessageItem
  | AssistantMessageItem
  | ClientToolCallItem
  | WidgetItem
  | TaskItem
  | WorkflowItem
  | EndOfTurnItem;

// ===== Types pour le statut des threads =====

export interface ThreadStatusBase {
  type: string;
  reason?: string;
}

export interface ActiveStatus extends ThreadStatusBase {
  type: 'active';
}

export interface ClosedStatus extends ThreadStatusBase {
  type: 'closed';
  reason?: string;
}

export interface LockedStatus extends ThreadStatusBase {
  type: 'locked';
  reason?: string;
}

export type ThreadStatus = ActiveStatus | ClosedStatus | LockedStatus;

export interface Thread {
  id: string;
  title?: string;
  items: ThreadItem[];
  metadata?: Record<string, unknown>;
  status?: ThreadStatus;
  /** Indicates if there are older messages that can be loaded */
  has_more_items?: boolean;
  /** Cursor for loading older messages */
  pagination_cursor?: string;
}

// ===== Types pour les listes paginées =====

export interface ListThreadsOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
}

export interface ThreadListResponse {
  data: Thread[];
  has_more: boolean;
  after?: string;
}

export interface ListItemsOptions {
  limit?: number;
  order?: 'asc' | 'desc';
  after?: string;
  before?: string;
}

export interface ItemListResponse {
  data: ThreadItem[];
  has_more: boolean;
  after?: string;
}
