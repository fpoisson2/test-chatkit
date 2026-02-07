/**
 * ChatKit component - Main chat interface with all features
 */
import React, { useState, useEffect, useCallback } from 'react';
import type {
  ChatKitControl,
  ChatKitOptions,
  ThreadItem,
  UserMessageContent,
  VoiceSessionWidget,
  OutboundCallWidget,
} from '../types';
import { WidgetRenderer } from '../widgets';
import type { WidgetContext } from '../widgets';
import { Composer } from './Composer';
import { MessageRenderer } from './MessageRenderer';
import { Header } from './Header';
import { useI18n } from '../../i18n/I18nProvider';
import { useScreencast } from '../hooks/useScreencast';
import { useKeyboardOffset } from '../hooks/useKeyboardOffset';
import { useScrollToBottom } from '../hooks/useScrollToBottom';
import { useDragAndDrop } from '../hooks/useDragAndDrop';
import { useAttachments } from '../hooks/useAttachments';
import { useInlineWidgets } from '../hooks/useInlineWidgets';
import { useWidgetActions } from '../hooks/useWidgetActions';
import { useAutoDismissError } from '../hooks/useAutoDismissError';
import type { Attachment } from '../api/attachments';
import { COPY_FEEDBACK_DELAY_MS } from '../utils';
import { getBackendBaseUrl } from '../../utils/backend';
import './ChatKit.css';

export interface ChatKitProps {
  control: ChatKitControl;
  options: ChatKitOptions;
  className?: string;
  style?: React.CSSProperties;
}

export function ChatKit({ control, options, className, style }: ChatKitProps): JSX.Element {
  const { t } = useI18n();
  const backendUrl = getBackendBaseUrl() || undefined;
  const [inputValue, setInputValue] = useState('');
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);

  const {
    header,
    startScreen,
    disclaimer,
    composer,
    theme,
    api,
    isAdmin,
  } = options;

  const attachmentsConfig = composer?.attachments;
  const attachmentsEnabled = attachmentsConfig?.enabled === true;

  // Extract auth token from API headers for DevToolsScreencast
  const authHeader =
    (api.headers?.['Authorization'] as string | undefined) ??
    (api.headers?.['authorization'] as string | undefined);
  const authToken = authHeader?.replace(/^Bearer\s+/i, '').trim() || undefined;

  // Scroll management
  const {
    messagesEndRef,
    messagesContainerRef,
    showScrollButton,
    scrollToBottom,
    scrollItemToTop,
  } = useScrollToBottom(control.thread?.items.length ?? 0, {}, control.thread?.id);

  // Keyboard offset for mobile virtual keyboards
  const { keyboardOffset } = useKeyboardOffset(messagesContainerRef);

  // Attachments management
  const {
    attachments,
    setAttachments,
    handleFilesSelected,
    clearAttachments,
  } = useAttachments({
    attachmentsConfig,
    apiConfig: api.url ? { url: api.url, headers: api.headers } : undefined,
  });

  // Drag and drop for file uploads
  const { isDraggingFiles, dragHandlers } = useDragAndDrop({
    enabled: attachmentsEnabled,
    onFilesDropped: handleFilesSelected,
  });

  // Screencast management hook
  const {
    activeScreencast,
    setActiveScreencast,
    lastScreencastScreenshot,
    dismissedScreencastItems,
    failedScreencastTokens,
    handleScreencastLastFrame,
    handleScreencastConnectionError,
    dismissScreencast,
  } = useScreencast({
    threadId: control.thread?.id,
    threadItems: (control.thread?.items || []) as ThreadItem[],
    isLoading: control.isLoading,
  });

  // Inline widgets (voice/outbound call)
  const { inlineVoiceWidget, inlineOutboundCallWidget } = useInlineWidgets({
    threadId: control.thread?.id,
    widgets: options.widgets,
  });

  // Widget actions context
  const { createWidgetContext } = useWidgetActions({
    control,
    widgets: options.widgets,
    scrollItemToTop,
  });

  // Auto-dismiss errors
  useAutoDismissError(control.error, control.clearError);

  // Clear the composer when switching threads
  useEffect(() => {
    setInputValue('');
    clearAttachments();
  }, [control.thread?.id, clearAttachments]);

  // Track last user message to clear composer after it's added to thread
  const [lastUserMessageId, setLastUserMessageId] = useState<string | null>(null);

  useEffect(() => {
    const items = (control.thread?.items || []) as ThreadItem[];
    if (!items.length) {
      setLastUserMessageId(null);
      return;
    }

    const lastUserMessage = [...items].reverse().find(item => item.type === 'user_message');
    if (!lastUserMessage) return;

    if (lastUserMessage.id !== lastUserMessageId) {
      console.log('[ChatKit] new user message detected:', lastUserMessage.id, 'prev:', lastUserMessageId);
      setInputValue('');
      clearAttachments();
      setLastUserMessageId(lastUserMessage.id);
      // Auto-scroll the new user message to the top of the visible area
      scrollItemToTop(lastUserMessage.id);
    }
  }, [control.thread?.items, lastUserMessageId, clearAttachments, scrollItemToTop]);

  // Callback to continue workflow
  const handleContinueWorkflow = useCallback(() => {
    control.customAction(null, { type: 'continue_workflow' });
  }, [control]);

  // Callback for composer submission
  const handleComposerSubmit = useCallback(async (message: string, uploadedAttachments: Attachment[], selectedModelId?: string | null) => {
    // Build message content
    const content: UserMessageContent[] = [];
    if (message) {
      content.push({ type: 'input_text', text: message });
    }
    for (const att of uploadedAttachments) {
      if (att.status === 'uploaded') {
        content.push({
          type: att.type as 'image' | 'file',
          [att.type]: att.id,
        } as UserMessageContent);
      }
    }

    // Build inference options if a model is selected
    const inferenceOptions = selectedModelId ? { model: selectedModelId } : undefined;

    // Send the message with inference options
    await control.sendMessage(content, inferenceOptions ? { inferenceOptions } : undefined);

    // Reset the form
    setInputValue('');
    clearAttachments();
  }, [control, clearAttachments]);

  const handlePromptClick = (prompt: string) => {
    control.sendMessage(prompt);
  };

  // Create a new thread
  const handleNewThread = () => {
    if (options.onThreadChange) {
      options.onThreadChange({ threadId: null });
    }
  };

  // Copy message content
  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), COPY_FEEDBACK_DELAY_MS);
  };

  // Show start screen only when there's no thread present (truly new conversation)
  // Don't show if:
  // - We have a thread (even empty)
  // - We're loading a thread
  // - We're transitioning to a new thread (initialThread !== current thread)
  // This prevents flash during thread change due to race condition between setState
  const isLoadingAnyThread = control.loadingThreadIds.size > 0;
  const isTransitioningToNewThread =
    options.initialThread != null &&
    options.initialThread !== control.thread?.id;
  const showStartScreen = !isLoadingAnyThread && !control.thread && !isTransitioningToNewThread;


  // Check if thread is closed or locked
  const threadStatus = control.thread?.status;
  const isThreadClosed = threadStatus?.type === 'closed';
  const isThreadLocked = threadStatus?.type === 'locked';
  const isThreadDisabled = isThreadClosed || isThreadLocked;
  const threadStatusMessage = isThreadDisabled
    ? (threadStatus?.reason || (isThreadClosed ? t('chatkit.thread.closed') : t('chatkit.thread.locked')))
    : null;

  // Get thread title
  const getThreadTitle = (): string => {
    if (showStartScreen) {
      return '';
    }

    if (!control.thread) {
      // If we're loading a thread or transitioning to one, don't show "New Conversation"
      // Only show it when we're truly starting a new conversation (not loading/transitioning)
      if (control.isLoading || isLoadingAnyThread || isTransitioningToNewThread) {
        return '';
      }
      return t('chatkit.thread.newConversation');
    }

    if (control.thread.title) {
      return control.thread.title;
    }

    return t('chatkit.thread.conversation');
  };

  // Get origin workflow name
  const getWorkflowName = (): string | undefined => {
    if (showStartScreen || !control.thread) {
      return undefined;
    }

    const workflowMetadata = control.thread.metadata?.workflow as {
      display_name?: string;
      slug?: string;
    } | undefined;

    return workflowMetadata?.display_name || workflowMetadata?.slug;
  };

  return (
    <div
      className={`chatkit ${className || ''}`}
      style={{
        ...style,
        ['--chatkit-keyboard-offset' as const]: `${keyboardOffset}px`,
      }}
      data-theme={theme?.colorScheme}
      {...dragHandlers}
    >
      {isDraggingFiles && attachmentsEnabled && (
        <DropOverlay />
      )}

      {/* Header */}
      <Header
        config={header}
        title={getThreadTitle()}
        workflowName={getWorkflowName()}
        showNewThreadButton={!showStartScreen}
        showHistoryButton={false}
        onNewThread={handleNewThread}
      />

      {/* Messages */}
      <div className="chatkit-messages" ref={messagesContainerRef}>
        {showStartScreen && startScreen ? (
          <StartScreen
            greeting={startScreen.greeting}
            prompts={startScreen.prompts}
            onPromptClick={handlePromptClick}
          />
        ) : (
          <>
            {/* Load older messages button */}
            {control.hasMoreItems && (
              <div className="chatkit-load-older">
                <button
                  className="chatkit-load-older-button"
                  onClick={control.loadOlderItems}
                  disabled={control.isLoadingOlderItems}
                >
                  {control.isLoadingOlderItems ? (
                    <span className="chatkit-load-older-loading">
                      <span className="chatkit-typing-dots">
                        <span></span>
                        <span></span>
                        <span></span>
                      </span>
                    </span>
                  ) : (
                    t('chat.loadOlderMessages')
                  )}
                </button>
              </div>
            )}
            <MessageList
            items={control.thread?.items || []}
            theme={theme?.colorScheme}
            copiedMessageId={copiedMessageId}
            onCopyMessage={handleCopyMessage}
            createWidgetContext={createWidgetContext}
            loadingLabel={t('chat.loading')}
            activeScreencast={activeScreencast}
            lastScreencastScreenshot={lastScreencastScreenshot}
            dismissedScreencastItems={dismissedScreencastItems}
            failedScreencastTokens={failedScreencastTokens}
            authToken={authToken}
            apiUrl={api.url}
            backendUrl={backendUrl}
            onScreencastLastFrame={handleScreencastLastFrame}
            onScreencastConnectionError={handleScreencastConnectionError}
            onActiveScreencastChange={setActiveScreencast}
            onDismissScreencast={dismissScreencast}
            onContinueWorkflow={handleContinueWorkflow}
            isAdmin={isAdmin}
            inlineVoiceWidget={inlineVoiceWidget}
            inlineOutboundCallWidget={inlineOutboundCallWidget}
          />
          </>
        )}

        {/* Loading indicator */}
        <LoadingIndicator
          thread={control.thread}
          loadingThreadIds={control.loadingThreadIds}
        />

        <div ref={messagesEndRef} className="chatkit-scroll-anchor" />
      </div>

      {/* Scroll to bottom button */}
      {showScrollButton && (
        <ScrollToBottomButton onClick={scrollToBottom} />
      )}

      {/* Error display */}
      {control.error && (
        <div className="chatkit-error" onClick={control.clearError} role="button" aria-label="Fermer l'erreur">
          <div className="chatkit-error-content">
            <span><strong>Erreur:</strong> {control.error.message}</span>
            <span className="chatkit-error-close">&times;</span>
          </div>
        </div>
      )}

      {/* Composer */}
      <Composer
        value={inputValue}
        onChange={setInputValue}
        attachments={attachments}
        onAttachmentsChange={setAttachments}
        onSubmit={handleComposerSubmit}
        isLoading={control.isLoading}
        isDisabled={isThreadDisabled}
        disabledMessage={threadStatusMessage || undefined}
        config={composer}
        disclaimer={disclaimer?.text}
        apiConfig={api.url ? { url: api.url, headers: api.headers } : undefined}
        onFilesSelected={handleFilesSelected}
        isDraggingFiles={isDraggingFiles}
      />
    </div>
  );
}

// ============================================================================
// Sub-components
// ============================================================================

function DropOverlay(): JSX.Element {
  return (
    <div className="chatkit-drop-overlay chatkit-drop-overlay--full">
      <div className="chatkit-drop-overlay-content">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <span>Déposez vos fichiers ici</span>
      </div>
    </div>
  );
}

interface StartScreenProps {
  greeting?: string;
  prompts?: Array<{ label: string; prompt: string; icon?: string }>;
  onPromptClick: (prompt: string) => void;
}

function StartScreen({ greeting, prompts, onPromptClick }: StartScreenProps): JSX.Element {
  return (
    <div className="chatkit-start-screen">
      {greeting && (
        <div className="chatkit-start-greeting">{greeting}</div>
      )}
      {prompts && prompts.length > 0 && (
        <div className="chatkit-start-prompts">
          {prompts.map((prompt, idx) => (
            <button
              key={idx}
              className="chatkit-start-prompt"
              onClick={() => onPromptClick(prompt.prompt)}
            >
              {prompt.icon && <span className="chatkit-prompt-icon">{prompt.icon}</span>}
              <span>{prompt.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface MessageListProps {
  items: ThreadItem[];
  theme?: 'light' | 'dark';
  copiedMessageId: string | null;
  onCopyMessage: (messageId: string, content: string) => void;
  createWidgetContext: (itemId: string) => WidgetContext;
  loadingLabel: string;
  activeScreencast: { token: string; itemId: string } | null;
  lastScreencastScreenshot: { itemId: string; src: string; action?: string } | null;
  dismissedScreencastItems: Set<string>;
  failedScreencastTokens: Set<string>;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
  onScreencastLastFrame: (itemId: string) => (frameDataUrl: string) => void;
  onScreencastConnectionError: (token: string) => void;
  onActiveScreencastChange: (state: { token: string; itemId: string } | null) => void;
  onDismissScreencast: (itemId: string) => void;
  onContinueWorkflow: () => void;
  isAdmin?: boolean;
  inlineVoiceWidget: VoiceSessionWidget | null;
  inlineOutboundCallWidget: OutboundCallWidget | null;
}

function MessageList({
  items,
  theme,
  copiedMessageId,
  onCopyMessage,
  createWidgetContext,
  loadingLabel,
  activeScreencast,
  lastScreencastScreenshot,
  dismissedScreencastItems,
  failedScreencastTokens,
  authToken,
  apiUrl,
  backendUrl,
  onScreencastLastFrame,
  onScreencastConnectionError,
  onActiveScreencastChange,
  onDismissScreencast,
  onContinueWorkflow,
  isAdmin,
  inlineVoiceWidget,
  inlineOutboundCallWidget,
}: MessageListProps): JSX.Element {
  const renderInlineWidgets = (
    voiceWidget: VoiceSessionWidget | null,
    outboundCallWidget: OutboundCallWidget | null,
    context: WidgetContext,
  ): React.ReactNode => {
    if (!voiceWidget && !outboundCallWidget) {
      return null;
    }

    return (
      <div className="chatkit-inline-widgets">
        {voiceWidget && <WidgetRenderer widget={voiceWidget} context={context} />}
        {outboundCallWidget && <WidgetRenderer widget={outboundCallWidget} context={context} />}
      </div>
    );
  };

  const inlineWidgetsElement = (inlineVoiceWidget || inlineOutboundCallWidget)
    ? renderInlineWidgets(inlineVoiceWidget, inlineOutboundCallWidget, createWidgetContext('inline-widgets'))
    : null;
  let hasInsertedInlineWidgets = false;

  const inlineWidgetsAfterItem = (candidate: ThreadItem, idx: number): boolean => {
    if (!inlineWidgetsElement || hasInsertedInlineWidgets) {
      return false;
    }

    if (candidate.type === 'user_message') {
      return true;
    }

    const isLastItem = idx === items.length - 1;
    return isLastItem;
  };

  const renderedItems = items.flatMap((item, idx) => {
    // Don't render end_of_turn
    if (item.type === 'end_of_turn') {
      return null;
    }

    const nodes: React.ReactNode[] = [
      <MessageRenderer
        key={item.id}
        item={item}
        theme={theme}
        copiedMessageId={copiedMessageId}
        onCopyMessage={onCopyMessage}
        createWidgetContext={createWidgetContext}
        loadingLabel={loadingLabel}
        activeScreencast={activeScreencast}
        lastScreencastScreenshot={lastScreencastScreenshot}
        dismissedScreencastItems={dismissedScreencastItems}
        failedScreencastTokens={failedScreencastTokens}
        authToken={authToken}
        apiUrl={apiUrl}
        backendUrl={backendUrl}
        onScreencastLastFrame={onScreencastLastFrame}
        onScreencastConnectionError={onScreencastConnectionError}
        onActiveScreencastChange={onActiveScreencastChange}
        onDismissScreencast={onDismissScreencast}
        onContinueWorkflow={onContinueWorkflow}
        isAdmin={isAdmin}
      />,
    ];

    if (inlineWidgetsAfterItem(item, idx)) {
      hasInsertedInlineWidgets = true;
      nodes.push(
        <React.Fragment key={`inline-widgets-${item.id}`}>
          {inlineWidgetsElement}
        </React.Fragment>,
      );
    }

    return nodes;
  });

  if (inlineWidgetsElement && !hasInsertedInlineWidgets) {
    renderedItems.push(
      <React.Fragment key="inline-widgets-tail">{inlineWidgetsElement}</React.Fragment>,
    );
  }

  return <>{renderedItems}</>;
}

interface LoadingIndicatorProps {
  thread: { id: string; items: ThreadItem[] } | null;
  loadingThreadIds: Set<string>;
}

function LoadingIndicator({ thread, loadingThreadIds }: LoadingIndicatorProps): JSX.Element | null {
  const items = thread?.items || [];
  const lastItem = items[items.length - 1];

  // Show typing indicator when:
  // - Thread exists and is active (waiting for assistant)
  // - Thread is being loaded (streaming in progress)
  // - Last message is from user (no response started yet)
  const hasMessages = items.length > 0;
  const isThreadActive = thread?.status?.type === 'active';
  const isLoadingCurrentThread =
    thread && loadingThreadIds.has(thread.id);
  const lastItemIsUserMessage = lastItem?.type === 'user_message';
  const isWaitingForUserInput = Boolean(thread?.metadata?.workflow_wait_for_user_input);

  // Show indicator if:
  // 1. Thread is actively being loaded (streaming) AND thread is active
  // 2. OR last item is user message AND thread is active
  const isWaitingForAssistant =
    thread &&
    isThreadActive &&
    !isWaitingForUserInput &&
    (isLoadingCurrentThread || (hasMessages && lastItemIsUserMessage));


  if (!isWaitingForAssistant) {
    return null;
  }

  return (
    <div className="chatkit-message chatkit-message-assistant">
      <div className="chatkit-message-content">
        <div className="chatkit-workflow-loading">
          <div className="chatkit-typing-dots">
            <span></span>
            <span></span>
            <span></span>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ScrollToBottomButtonProps {
  onClick: () => void;
}

function ScrollToBottomButton({ onClick }: ScrollToBottomButtonProps): JSX.Element {
  return (
    <button
      className="chatkit-scroll-to-bottom"
      onClick={onClick}
      aria-label="Aller en bas"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <polyline points="6 9 12 15 18 9"></polyline>
      </svg>
    </button>
  );
}
