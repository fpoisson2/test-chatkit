/**
 * Module ChatKit React personnalisé
 * Remplace @openai/chatkit-react avec toutes les fonctionnalités de chatkit-python
 */

// Types
export type * from './types';

// Composants
export { ChatKit } from './components/ChatKit';
export type { ChatKitProps } from './components/ChatKit';
export { WorkflowRenderer } from './components/WorkflowRenderer';
export { TaskRenderer } from './components/TaskRenderer';
export { AnnotationRenderer } from './components/AnnotationRenderer';

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
export {
  streamChatKitEvents,
  fetchThread,
  sendClientToolOutput,
  sendCustomAction,
  retryAfterItem,
  submitFeedback,
  updateThreadMetadata,
  listThreads,
  deleteThread,
  listItems,
} from './api/streaming';
export type { StreamOptions } from './api/streaming';
export {
  uploadAttachment,
  createFilePreview,
  generateAttachmentId,
  validateFile,
} from './api/attachments';
export type { Attachment } from './api/attachments';
