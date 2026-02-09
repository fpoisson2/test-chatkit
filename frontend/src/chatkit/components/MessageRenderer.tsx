import React, { useMemo, useRef, useState } from 'react';
import type { ThreadItem } from '../types';
import type { WidgetContext } from '../widgets';
import { WidgetRenderer } from '../widgets';
import { MarkdownRenderer, MemoizedMarkdownRenderer } from './MarkdownRenderer';
import { WorkflowRenderer } from './WorkflowRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AnnotationRenderer } from './AnnotationRenderer';
import { LoadingIndicator } from './LoadingIndicator';
import { DevToolsScreencast, clearFatalErrorForToken, fatalErrorTokens } from './DevToolsScreencast';
import { SSHTerminal } from './SSHTerminal';
import { VNCScreencast } from './VNCScreencast';
import { FileAttachmentDisplay } from './FileAttachmentDisplay';
import { ImageWithBlobUrl, exportToDocx, exportToPdf } from '../utils';
import { useI18n } from '../../i18n/I18nProvider';

export interface MessageRendererProps {
  item: ThreadItem;
  theme?: string;
  copiedMessageId: string | null;
  onCopyMessage: (messageId: string, content: string) => void;
  createWidgetContext: (itemId: string) => WidgetContext;
  loadingLabel: string;
  // Screencast props
  activeScreencast: { token: string; itemId: string } | null;
  lastScreencastScreenshot: { itemId: string; src: string; action?: string } | null;
  dismissedScreencastItems: Set<string>;
  failedScreencastTokens: Set<string>;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
  onScreencastLastFrame: (itemId: string) => (frameDataUrl: string) => void;
  onScreencastConnectionError: (token: string) => void;
  onActiveScreencastChange: (screencast: { token: string; itemId: string } | null) => void;
  onDismissScreencast: (itemId: string) => void;
  onContinueWorkflow: () => void;
  // Admin props for cost tracking
  isAdmin?: boolean;
  /** Si true, c'est le dernier workflow du thread (potentiellement actif/en streaming) */
  isLastWorkflowItem?: boolean;
  // Branch editing props
  /** Callback when user wants to edit a message */
  onEditMessage?: (itemId: string, content: string) => void;
  /** Whether branching is enabled */
  branchingEnabled?: boolean;
}

/**
 * Component to display final images with wrapper
 */
function FinalImageDisplay({
  src,
  authToken,
  apiUrl,
  backendUrl,
}: {
  src: string;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
}): JSX.Element | null {
  return (
    <div className="chatkit-image-generation-preview">
      <ImageWithBlobUrl
        src={src}
        alt="Image générée"
        className="chatkit-generated-image-final"
        authToken={authToken}
        apiUrl={apiUrl}
        backendUrl={backendUrl}
      />
    </div>
  );
}

const isLikelyJson = (value: string): boolean => {
  const trimmed = value.trim();
  if (!trimmed || (trimmed[0] !== '{' && trimmed[0] !== '[')) {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
};

/**
 * Helper to find attachment details by ID
 */
function findAttachment(
  attachmentId: string,
  attachments?: Array<{ id: string; name: string; mime_type: string; type: string }>
) {
  return attachments?.find(att => att.id === attachmentId);
}

/**
 * Renders a user message
 */
function UserMessageContent({
  item,
  theme,
  authToken,
  apiUrl,
  backendUrl,
  onEditMessage,
  branchingEnabled,
}: {
  item: ThreadItem;
  theme?: string;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
  onEditMessage?: (itemId: string, content: string) => void;
  branchingEnabled?: boolean;
}): JSX.Element {
  const { t } = useI18n();

  if (item.type !== 'user_message') return <></>;

  // Extract text content for editing
  const getTextContent = (): string => {
    return item.content
      .filter((c) => c.type === 'input_text')
      .map((c) => c.text)
      .join('\n');
  };

  const handleEdit = () => {
    const content = getTextContent();
    if (onEditMessage && content) {
      onEditMessage(item.id, content);
    }
  };

  return (
    <>
      <div className="chatkit-message-content">
        {item.content.map((content, idx) => (
          <div key={idx}>
            {content.type === 'input_text' && <MarkdownRenderer content={content.text} theme={theme} />}
            {content.type === 'input_tag' && (
              <span className="chatkit-tag">{content.text}</span>
            )}
            {content.type === 'image' && (
              <ImageWithBlobUrl src={content.image} alt="" authToken={authToken} apiUrl={apiUrl} backendUrl={backendUrl} />
            )}
            {content.type === 'file' && (
              <FileAttachmentDisplay
                attachmentId={content.file}
                attachment={findAttachment(content.file, item.attachments)}
                authToken={authToken}
              />
            )}
          </div>
        ))}
        {/* Render any attachments not in content (legacy support) */}
        {item.attachments && item.attachments.length > 0 && (
          <div className="chatkit-attachments">
            {item.attachments
              .filter(att => !item.content.some(c => c.type === 'file' && c.file === att.id))
              .map((att, idx) => (
                <FileAttachmentDisplay
                  key={`att-${idx}`}
                  attachmentId={att.id}
                  attachment={att}
                  authToken={authToken}
                />
              ))}
          </div>
        )}
        {item.quoted_text && (
          <div className="chatkit-quoted-text">
            <blockquote>{item.quoted_text}</blockquote>
          </div>
        )}
      </div>
      {/* Edit button for branching */}
      {branchingEnabled && onEditMessage && getTextContent() && (
        <div className="chatkit-message-actions chatkit-message-actions-user">
          <button
            className="chatkit-message-edit-button"
            onClick={handleEdit}
            title={t('chatkit.message.edit') || 'Edit message'}
          >
            <svg
              viewBox="0 0 24 24"
              width="14"
              height="14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
        </div>
      )}
    </>
  );
}

/**
 * Helper function to format cost
 */
function formatCost(cost: number): string {
  if (cost < 0.0001) {
    return `$${cost.toFixed(6)}`;
  } else if (cost < 0.01) {
    return `$${cost.toFixed(4)}`;
  } else {
    return `$${cost.toFixed(2)}`;
  }
}

/**
 * Renders an assistant message
 */
function AssistantMessageContent({
  item,
  theme,
  copiedMessageId,
  onCopyMessage,
  createWidgetContext,
  loadingLabel,
  isAdmin,
}: {
  item: ThreadItem;
  theme?: string;
  copiedMessageId: string | null;
  onCopyMessage: (messageId: string, content: string) => void;
  createWidgetContext: (itemId: string) => WidgetContext;
  loadingLabel: string;
  isAdmin?: boolean;
}): JSX.Element {
  const { t } = useI18n();
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  if (item.type !== 'assistant_message') return <></>;

  const usageMetadata = item.usage_metadata;

  const getTextContent = () => {
    return item.content
      .filter((c: any) => c.type === 'output_text')
      .map((c: any) => c.text)
      .join('\n\n');
  };

  const lastOutputIndex = useMemo(() => {
    for (let i = item.content.length - 1; i >= 0; i -= 1) {
      if ((item.content[i] as any).type === 'output_text') {
        return i;
      }
    }
    return -1;
  }, [item.content]);

  const handleExportPdf = async () => {
    setExportingFormat('pdf');
    try {
      // Use the DOM element if available, otherwise fall back to markdown
      if (contentRef.current) {
        await exportToPdf(contentRef.current, undefined, theme as 'light' | 'dark');
      } else {
        await exportToPdf(getTextContent(), undefined, theme as 'light' | 'dark');
      }
    } finally {
      setExportingFormat(null);
    }
  };

  const handleExportDocx = async () => {
    setExportingFormat('docx');
    try {
      const content = getTextContent();
      if (!content || content.trim().length === 0) {
        return;
      }
      await exportToDocx(content);
    } catch (_error) {
      // Error ignored
    } finally {
      setExportingFormat(null);
    }
  };

  return (
    <>
      <div className="chatkit-message-content" ref={contentRef}>
        {item.content
          .map((content, originalIndex) => ({ content, originalIndex }))
          .filter(({ content }) => {
            if (content.type !== 'output_text') {
              return true;
            }
            const rawText = content.text ?? '';
            return !isLikelyJson(rawText);
          })
          .map(({ content, originalIndex }) => {
            const isAssistantStreaming =
              item.type === 'assistant_message' && item.status === 'in_progress';
            const isStreamingBlock = isAssistantStreaming && originalIndex === lastOutputIndex;

            return (
              <div key={originalIndex}>
                {content.type === 'output_text' && (
                  <>
                    <MemoizedMarkdownRenderer
                      content={content.text}
                      theme={theme}
                      isStreaming={isStreamingBlock}
                    />
                    {content.annotations && content.annotations.length > 0 && (
                      <AnnotationRenderer annotations={content.annotations} />
                    )}
                  </>
                )}
                {content.type === 'widget' && (
                  <WidgetRenderer widget={content.widget} context={createWidgetContext(item.id)} />
                )}
              </div>
            );
          })}
        {item.status === 'in_progress' && <LoadingIndicator label={loadingLabel} />}
      </div>
      {item.status !== 'in_progress' && (
        <div className="chatkit-message-actions">
          {/* Copy button */}
          <button
            className={`chatkit-action-button ${copiedMessageId === item.id ? 'copied' : ''}`}
            onClick={() => onCopyMessage(item.id, getTextContent())}
            title={t('chatkit.message.copy')}
          >
            {copiedMessageId === item.id ? (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            )}
          </button>
        </div>
      )}
      {/* Cost tracking for admins */}
      {isAdmin && usageMetadata && item.status !== 'in_progress' && (
        <div className="chatkit-usage-metadata">
          <span className="chatkit-usage-tokens">
            {usageMetadata.input_tokens} + {usageMetadata.output_tokens} tokens
          </span>
          {usageMetadata.cost > 0 && (
            <span className="chatkit-usage-cost">
              {formatCost(usageMetadata.cost)}
            </span>
          )}
          {usageMetadata.model && (
            <span className="chatkit-usage-model">
              {usageMetadata.model}
            </span>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Renders a client tool call
 */
function ClientToolCallContent({ item }: { item: ThreadItem }): JSX.Element {
  if (item.type !== 'client_tool_call') return <></>;

  return (
    <div className="chatkit-message-content chatkit-tool-call">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
      </svg>
      <span>{item.name}</span>
      {item.status === 'pending' && <span className="chatkit-tool-status"> (en cours...)</span>}
      {item.status === 'completed' && (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="chatkit-tool-check">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      )}
    </div>
  );
}

/**
 * Renders a standalone widget
 */
function WidgetContent({
  item,
  createWidgetContext,
}: {
  item: ThreadItem;
  createWidgetContext: (itemId: string) => WidgetContext;
}): JSX.Element {
  if (item.type !== 'widget') return <></>;

  return (
    <div className="chatkit-message-content">
      <WidgetRenderer widget={item.widget} context={createWidgetContext(item.id)} />
    </div>
  );
}

/**
 * Renders a standalone task
 */
function TaskContent({
  item,
  theme,
  apiUrl,
  backendUrl,
}: { item: ThreadItem; theme?: string; apiUrl?: string; backendUrl?: string }): JSX.Element | null {
  if (item.type !== 'task') return null;

  const task = item.task as any;
  const hasJsonContent =
    task?.type === 'custom' && typeof task?.content === 'string' && isLikelyJson(task.content);

  if (hasJsonContent) {
    return null;
  }

  return (
    <div className="chatkit-message-content">
      <TaskRenderer task={task} theme={theme} apiUrl={apiUrl} backendUrl={backendUrl} />
    </div>
  );
}

/**
 * Renders workflow content including images and computer_use screenshots
 */
function WorkflowContent({
  item,
  theme,
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
}: {
  item: ThreadItem;
  theme?: string;
  activeScreencast: { token: string; itemId: string } | null;
  lastScreencastScreenshot: { itemId: string; src: string; action?: string } | null;
  dismissedScreencastItems: Set<string>;
  failedScreencastTokens: Set<string>;
  authToken?: string;
  apiUrl?: string;
  backendUrl?: string;
  onScreencastLastFrame: (itemId: string) => (frameDataUrl: string) => void;
  onScreencastConnectionError: (token: string) => void;
  onActiveScreencastChange: (screencast: { token: string; itemId: string } | null) => void;
  onDismissScreencast: (itemId: string) => void;
  onContinueWorkflow: () => void;
}): JSX.Element | null {
  if (item.type !== 'workflow') return null;

  return (
    <>
      <div className="chatkit-message-content">
        <WorkflowRenderer
          key={`${item.id}-${item.workflow.summary?.title || 'default'}`}
          workflow={item.workflow}
          theme={theme}
          authToken={authToken}
          apiUrl={apiUrl}
          backendUrl={backendUrl}
        />
      </div>

      {/* Image generation preview/final */}
      {(() => {
        const imageTask = item.workflow.tasks.find((task: any) => task.type === 'image');
        if (imageTask && imageTask.images && imageTask.images.length > 0) {
          const image = imageTask.images[0];
          const isLoading = imageTask.status_indicator === 'loading';

          if (isLoading && image.partials && image.partials.length > 0) {
            const lastPartial = image.partials[image.partials.length - 1];
            const src = lastPartial.startsWith('data:')
              ? lastPartial
              : `data:image/png;base64,${lastPartial}`;
            return (
              <div className="chatkit-image-generation-preview">
                <ImageWithBlobUrl
                  src={src}
                  alt="Génération en cours..."
                  className="chatkit-generating-image"
                  authToken={authToken}
                  apiUrl={apiUrl}
                  backendUrl={backendUrl}
                />
              </div>
            );
          }

          if (!isLoading) {
            let src = image.data_url || image.image_url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : '');
            // Ne pas traiter les URLs relatives (/api/...) comme du base64
            if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
              src = `data:image/png;base64,${src}`;
            }
            if (src) {
              return <FinalImageDisplay src={src} authToken={authToken} apiUrl={apiUrl} />;
            }
          }
        }
        return null;
      })()}

      {/* Computer use screenshots */}
      {(() => {
        const computerUseTasks = item.workflow.tasks.filter((task: any) => task.type === 'computer_use');

        let computerUseTask = computerUseTasks.find(
          (task: any) => task.status_indicator === 'loading' && (task.debug_url_token || task.ssh_token || task.vnc_token)
        );

        if (!computerUseTask) {
          const tasksWithToken = computerUseTasks.filter((task: any) => task.debug_url_token || task.ssh_token || task.vnc_token);
          computerUseTask = tasksWithToken[tasksWithToken.length - 1];
        }

        if (!computerUseTask && computerUseTasks.length > 0) {
          computerUseTask = computerUseTasks[computerUseTasks.length - 1];
        }

        if (computerUseTask) {
          const hasScreenshots = computerUseTask.screenshots && computerUseTask.screenshots.length > 0;
          const screenshot = hasScreenshots ? computerUseTask.screenshots[computerUseTask.screenshots.length - 1] : null;
          const isLoading = computerUseTask.status_indicator === 'loading';

          let src = screenshot ? (screenshot.data_url || screenshot.image_url || (screenshot.b64_image ? `data:image/png;base64,${screenshot.b64_image}` : '')) : '';

          // Ne pas traiter les URLs relatives (/api/...) comme du base64
          if (src && !src.startsWith('data:') && !src.startsWith('http') && !src.startsWith('/')) {
            src = `data:image/png;base64,${src}`;
          }

          const debugUrlToken =
            computerUseTask.debug_url_token ||
            (activeScreencast?.itemId === item.id ? activeScreencast.token : undefined);
          const sshToken = computerUseTask.ssh_token;
          const vncToken = computerUseTask.vnc_token;

          const isActiveScreencast = activeScreencast?.itemId === item.id && !!debugUrlToken;
          // Do not show the browser screencast when SSH/VNC sessions are available
          const showLiveScreencast = isActiveScreencast && !!debugUrlToken && !sshToken && !vncToken;
          const showSSHTerminal = !!sshToken;
          const showVNCScreencast = !!vncToken;

          if (!src && lastScreencastScreenshot && lastScreencastScreenshot.itemId === item.id) {
            src = lastScreencastScreenshot.src;
          }

          const isComplete = computerUseTask.status_indicator === 'complete';
          const isError = computerUseTask.status_indicator === 'error';
          const isTerminal = isComplete || isError;
          // Never show screenshots for SSH/VNC sessions (they have no meaningful screenshots)
          const showScreenshot = !!src && !showLiveScreencast && !showSSHTerminal && !showVNCScreencast && !isTerminal && !sshToken && !vncToken;

          const isDismissed = dismissedScreencastItems.has(item.id);
          const isTokenFailed = debugUrlToken && fatalErrorTokens.has(debugUrlToken);
          const shouldShowLiveScreencast = showLiveScreencast && !isDismissed && !isTokenFailed;
          // Keep SSH and VNC screencasts visible even when task is complete, until user dismisses
          const shouldShowSSHTerminal = showSSHTerminal && !isDismissed;
          const shouldShowVNCScreencast = showVNCScreencast && !isDismissed;
          const shouldShowScreenshot = showScreenshot;
          const showPreview = shouldShowLiveScreencast || shouldShowSSHTerminal || shouldShowVNCScreencast || shouldShowScreenshot;
          const screenshotIsLoading = isLoading && !isDismissed;

          let actionTitle = computerUseTask.current_action || screenshot?.action_description;
          if (!screenshot && lastScreencastScreenshot && lastScreencastScreenshot.itemId === item.id) {
            actionTitle = actionTitle || lastScreencastScreenshot.action;
          }
          const clickPosition = screenshot?.click_position || screenshot?.click;

          const toPercent = (value: number): number => {
            const scaled = value <= 1 ? value * 100 : value;
            return Math.min(100, Math.max(0, scaled));
          };

          const clickCoordinates = clickPosition
            ? { x: toPercent(clickPosition.x), y: toPercent(clickPosition.y) }
            : null;

          if (showPreview) {
            const handleEndSession = () => {
              onDismissScreencast(item.id);
              onContinueWorkflow();
            };

            return (
              <div className="chatkit-computer-use-preview">
                {shouldShowLiveScreencast && (
                  <>
                    <DevToolsScreencast
                      debugUrlToken={debugUrlToken as string}
                      authToken={authToken}
                      enableInput
                      onConnectionError={() => {
                        onScreencastConnectionError(debugUrlToken as string);
                        onActiveScreencastChange(
                          activeScreencast?.token === debugUrlToken ? null : activeScreencast
                        );
                      }}
                      onScreencastConnectionError={onScreencastConnectionError}
                      onLastFrame={onScreencastLastFrame(item.id)}
                    />
                    <div className="chatkit-computer-use-actions">
                      <button
                        type="button"
                        onClick={handleEndSession}
                        className="chatkit-end-session-button"
                      >
                        Terminer la session et continuer
                      </button>
                    </div>
                  </>
                )}
                {shouldShowSSHTerminal && sshToken && (
                  <>
                    <SSHTerminal
                      sshToken={sshToken}
                      authToken={authToken}
                      onConnectionError={() => {
                        // Error ignored
                      }}
                      onClose={() => {
                        // Session closed
                      }}
                    />
                    <div className="chatkit-computer-use-actions">
                      <button
                        type="button"
                        onClick={handleEndSession}
                        className="chatkit-end-session-button"
                      >
                        Terminer la session SSH et continuer
                      </button>
                    </div>
                  </>
                )}
                {shouldShowVNCScreencast && vncToken && (
                  <>
                    <VNCScreencast
                      vncToken={vncToken}
                      authToken={authToken}
                      enableInput
                      onConnectionError={() => {
                        // Error ignored
                      }}
                      onLastFrame={onScreencastLastFrame(item.id)}
                    />
                    <div className="chatkit-computer-use-actions">
                      <button
                        type="button"
                        onClick={handleEndSession}
                        className="chatkit-end-session-button"
                      >
                        Terminer la session VNC et continuer
                      </button>
                    </div>
                  </>
                )}
                {shouldShowScreenshot && (
                  <div className="chatkit-browser-screenshot-container">
                    <div className="chatkit-browser-screenshot-image-wrapper">
                    <ImageWithBlobUrl
                      src={src}
                      alt={actionTitle || "Browser automation"}
                      className={screenshotIsLoading ? "chatkit-browser-screenshot chatkit-browser-screenshot--loading" : "chatkit-browser-screenshot"}
                      authToken={authToken}
                      apiUrl={apiUrl}
                      backendUrl={backendUrl}
                    />
                      {clickCoordinates && (
                        <div
                          className="chatkit-browser-click-indicator"
                          style={{ left: `${clickCoordinates.x}%`, top: `${clickCoordinates.y}%` }}
                          aria-label={actionTitle || "Browser automation"}
                        />
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          }
        }
        return null;
      })()}
    </>
  );
}

/**
 * Main message renderer component
 */
export function MessageRenderer({
  item,
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
  isLastWorkflowItem = false,
  onEditMessage,
  branchingEnabled = false,
}: MessageRendererProps): JSX.Element | null {
  // Don't render end_of_turn
  if (item.type === 'end_of_turn') {
    return null;
  }

  const messageClass = item.type === 'user_message'
    ? 'user'
    : item.type === 'client_tool_call'
    ? 'tool'
    : item.type === 'widget' || item.type === 'task' || item.type === 'workflow'
    ? 'standalone'
    : 'assistant';

  return (
    <div className={`chatkit-message chatkit-message-${messageClass} chatkit-item-${item.type}`} data-item-id={item.id}>
      {item.type === 'user_message' && (
        <UserMessageContent
          item={item}
          theme={theme}
          authToken={authToken}
          apiUrl={apiUrl}
          backendUrl={backendUrl}
          onEditMessage={onEditMessage}
          branchingEnabled={branchingEnabled}
        />
      )}

      {item.type === 'assistant_message' && (
        <AssistantMessageContent
          item={item}
          theme={theme}
          copiedMessageId={copiedMessageId}
          onCopyMessage={onCopyMessage}
          createWidgetContext={createWidgetContext}
          loadingLabel={loadingLabel}
          isAdmin={isAdmin}
        />
      )}

      {item.type === 'client_tool_call' && (
        <ClientToolCallContent item={item} />
      )}

      {item.type === 'widget' && (
        <WidgetContent item={item} createWidgetContext={createWidgetContext} />
      )}

      {item.type === 'task' && (
        <TaskContent item={item} theme={theme} apiUrl={apiUrl} backendUrl={backendUrl} />
      )}
      {item.type === 'workflow' && (
        <WorkflowContent
          item={item}
          theme={theme}
          activeScreencast={activeScreencast}
          lastScreencastScreenshot={lastScreencastScreenshot}
          dismissedScreencastItems={dismissedScreencastItems}
          failedScreencastTokens={failedScreencastTokens}
          authToken={authToken}
          apiUrl={apiUrl}
          onScreencastLastFrame={onScreencastLastFrame}
          onScreencastConnectionError={onScreencastConnectionError}
          onActiveScreencastChange={onActiveScreencastChange}
          onDismissScreencast={onDismissScreencast}
          onContinueWorkflow={onContinueWorkflow}
        />
      )}
    </div>
  );
}
