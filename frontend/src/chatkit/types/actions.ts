/**
 * Types pour les actions et inférences ChatKit
 */

export type ActionConfig = {
  type: string;
  [key: string]: unknown;
};

export interface Action<T extends string = string, D = unknown> {
  type: T;
  data?: D;
}

export interface InferenceOptions {
  tool_choice?: ToolChoice;
  model?: string;
}

export interface ToolChoice {
  id: string;
}

export type FeedbackKind = 'positive' | 'negative';

export interface ComposerModel {
  id: string;
  label: string;
  description?: string;
  default?: boolean;
}
