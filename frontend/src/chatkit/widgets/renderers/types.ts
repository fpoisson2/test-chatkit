import type { ActionConfig, VoiceSessionWidgetContext, OutboundCallWidgetContext } from '../../types';

export interface WidgetContext {
  onAction?: (action: ActionConfig) => void;
  onFormData?: (data: FormData) => void;
  voiceSession?: VoiceSessionWidgetContext;
  outboundCall?: OutboundCallWidgetContext;
}

export type WidgetNode = Record<string, unknown>;

export type RenderChildrenFn = (children: WidgetNode[], context: WidgetContext) => React.ReactNode;
