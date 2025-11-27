/**
 * Types pour les messages et contenus ChatKit
 */

import type { WidgetRoot } from './widgets';
import type { OutboundCallStatus } from './voice';

// ===== Types pour le contenu utilisateur =====

export interface UserMessageTextContent {
  type: 'input_text';
  text: string;
}

export interface UserMessageImageContent {
  type: 'image';
  image: string;
}

export interface UserMessageFileContent {
  type: 'file';
  file: string;
}

export interface UserMessageTagContent {
  type: 'input_tag';
  id: string;
  text: string;
  data: Record<string, unknown>;
  interactive?: boolean;
}

export type UserMessageContent = UserMessageTextContent | UserMessageImageContent | UserMessageFileContent | UserMessageTagContent;

// ===== Types pour les pièces jointes =====

export interface MessageAttachment {
  id: string;
  name: string;
  mime_type: string;
  type: 'file' | 'image';
  upload_url?: string | null;
}

export interface UserMessageItem {
  type: 'user_message';
  id: string;
  content: UserMessageContent[];
  created_at: string;
  attachments?: MessageAttachment[];
  quoted_text?: string;
}

// ===== Types pour les sources =====

export interface SourceBase {
  title: string;
  description?: string;
  timestamp?: string;
  group?: string;
}

export interface URLSource extends SourceBase {
  type: 'url';
  url: string;
  attribution?: string;
}

export interface FileSource extends SourceBase {
  type: 'file';
  filename: string;
}

export interface EntitySource extends SourceBase {
  type: 'entity';
  id: string;
  icon?: string;
  preview?: 'lazy';
  data?: Record<string, unknown>;
}

export type Source = URLSource | FileSource | EntitySource;

// ===== Types pour les annotations =====

export interface Annotation {
  type: 'annotation';
  source: Source;
  index?: number;
}

// ===== Types pour le contenu assistant =====

export interface AssistantMessageTextContent {
  type: 'output_text';
  text: string;
  annotations?: Annotation[];
}

export interface AssistantMessageWidgetContent {
  type: 'widget';
  widget: WidgetRoot;
}

export type AssistantMessageContent = AssistantMessageTextContent | AssistantMessageWidgetContent;

// ===== Types pour les métadonnées d'utilisation =====

export interface UsageMetadata {
  input_tokens: number;
  output_tokens: number;
  cost: number;
  model?: string;
}

export interface AssistantMessageItem {
  type: 'assistant_message';
  id: string;
  content: AssistantMessageContent[];
  created_at: string;
  status?: 'in_progress' | 'completed' | 'failed';
  reasoning_id?: string;
  usage_metadata?: UsageMetadata;
}

export interface ClientToolCallItem {
  type: 'client_tool_call';
  id: string;
  created_at: string;
  thread_id: string;
  status: 'pending' | 'completed';
  call_id: string;
  name: string;
  arguments: Record<string, unknown>;
  output?: unknown;
}

// ===== Types pour les tasks =====

export interface BaseTask {
  status_indicator?: 'none' | 'loading' | 'complete';
}

export interface CustomTask extends BaseTask {
  type: 'custom';
  title?: string;
  icon?: string;
  content?: string;
}

export interface SearchTask extends BaseTask {
  type: 'web_search';
  title?: string;
  title_query?: string;
  queries?: string[];
  sources?: URLSource[];
}

export interface ThoughtTask extends BaseTask {
  type: 'thought';
  title?: string;
  content: string;
}

export interface FileTask extends BaseTask {
  type: 'file';
  title?: string;
  sources?: FileSource[];
}

export interface GeneratedImage {
  id: string;
  b64_json?: string;
  data_url?: string;
  image_url?: string;
  output_format?: 'png' | 'webp' | 'jpeg' | 'auto';
  background?: 'transparent' | 'opaque' | 'auto';
  quality?: 'low' | 'medium' | 'high' | 'auto';
  size?: '1024x1024' | '1024x1536' | '1536x1024' | 'auto';
  partials?: string[];
}

export interface ImageTask extends BaseTask {
  type: 'image';
  title?: string;
  images?: GeneratedImage[];
  call_id?: string;
  output_index?: number;
}

export interface ComputerUseScreenshot {
  id: string;
  b64_image?: string;
  data_url?: string;
  timestamp?: string;
  action_description?: string;
  click_position?: {
    x: number;
    y: number;
  };
  click?: {
    x: number;
    y: number;
  };
}

export interface ComputerUseTask extends BaseTask {
  type: 'computer_use';
  title?: string;
  screenshots?: ComputerUseScreenshot[];
  current_action?: string;
  action_sequence?: string[];
  call_id?: string;
  debug_url?: string;
  debug_url_token?: string;
  ssh_token?: string;
  vnc_token?: string;
}

export interface VoiceAgentTask extends BaseTask {
  type: 'voice_agent';
  title?: string;
  description?: string;
}

export interface OutboundCallTask extends BaseTask {
  type: 'outbound_call';
  title?: string;
  description?: string;
  toNumber?: string;
  callId?: string;
  status?: OutboundCallStatus;
}

export type Task =
  | CustomTask
  | SearchTask
  | ThoughtTask
  | FileTask
  | ImageTask
  | ComputerUseTask
  | VoiceAgentTask
  | OutboundCallTask;

// ===== Types pour les workflows =====

export interface CustomSummary {
  title: string;
  icon?: string;
}

export interface DurationSummary {
  duration: number;
}

export type WorkflowSummary = CustomSummary | DurationSummary;

export interface Workflow {
  type: 'custom' | 'reasoning';
  tasks: Task[];
  summary?: WorkflowSummary;
  expanded?: boolean;
  completed?: boolean;
}
