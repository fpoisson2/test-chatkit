import type { ActionConfig, VoiceSessionWidgetContext } from '../../types';

export interface WidgetContext {
  onAction?: (action: ActionConfig) => void;
  onFormData?: (data: FormData) => void;
  voiceSession?: VoiceSessionWidgetContext;
}

export type WidgetNode = Record<string, unknown>;

export type RenderChildrenFn = (children: WidgetNode[], context: WidgetContext) => React.ReactNode;
