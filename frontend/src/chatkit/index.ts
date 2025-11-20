/**
 * Module ChatKit React personnalisé
 * Remplace @openai/chatkit-react avec toutes les fonctionnalités de chatkit-python
 */

// Types
export type * from './types';

// Composants
export { ChatKit } from './components/ChatKit';
export type { ChatKitProps } from './components/ChatKit';

// Hooks
export { useChatKit } from './hooks/useChatKit';
export type { UseChatKitReturn } from './hooks/useChatKit';

// Widgets
export {
  WidgetRenderer,
  WidgetListRenderer,
  useWidgetContext,
} from './widgets';
export type {
  WidgetRendererProps,
  WidgetListRendererProps,
  WidgetContext,
} from './widgets';

// API
export { streamChatKitEvents, fetchThread } from './api/streaming';
export type { StreamOptions } from './api/streaming';
