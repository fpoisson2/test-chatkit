/**
 * Composant ChatKit complet avec toutes les fonctionnalités
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  ChatKitControl,
  ChatKitOptions,
  ThreadItem,
  ActionConfig,
  UserMessageContent,
  VoiceSessionWidget,
} from '../types';
import { WidgetRenderer } from '../widgets';
import type { WidgetContext } from '../widgets';
import { WorkflowRenderer } from './WorkflowRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AnnotationRenderer } from './AnnotationRenderer';
import { ThreadHistory } from './ThreadHistory';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DevToolsScreencast } from './DevToolsScreencast';
import { Composer } from './Composer';
import { useI18n } from '../../i18n/I18nProvider';
import { LoadingIndicator } from './LoadingIndicator';
import type { Attachment } from '../api/attachments';
import { ImageWithBlobUrl, COPY_FEEDBACK_DELAY_MS } from '../utils';
import './ChatKit.css';

export interface ChatKitProps {
  control: ChatKitControl;
  options: ChatKitOptions;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Component to display final images with wrapper
 */
function FinalImageDisplay({ src }: { src: string }): JSX.Element | null {
  return (
    <div className="chatkit-image-generation-preview">
      <ImageWithBlobUrl
        src={src}
        alt="Image générée"
        className="chatkit-generated-image-final"
      />
    </div>
  );
}

export function ChatKit({ control, options, className, style }: ChatKitProps): JSX.Element {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [activeScreencast, setActiveScreencast] = useState<{ token: string; itemId: string } | null>(null);
  const [lastScreencastScreenshot, setLastScreencastScreenshot] = useState<{ itemId: string; src: string; action?: string } | null>(null);
  const [dismissedScreencastItems, setDismissedScreencastItems] = useState<Set<string>>(new Set());
  // Track tokens that have failed connection (to prevent reactivation loops)
  const [failedScreencastTokens, setFailedScreencastTokens] = useState<Set<string>>(new Set());
  // Ref to track activeScreencast without triggering useEffect re-runs
  const activeScreencastRef = useRef<{ token: string; itemId: string } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const previousKeyboardOffsetRef = useRef(0);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const formDataRef = useRef<FormData | null>(null);

  const {
    header,
    history,
    startScreen,
    disclaimer,
    composer,
    theme,
    api,
  } = options;

  // Extract auth token from API headers for DevToolsScreencast
  const authToken = api.headers?.['Authorization']?.replace('Bearer ', '') || undefined;

  // Auto-scroll vers le bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [control.thread?.items.length]);

  // Clear failed tokens when thread changes (new thread or switching threads)
  useEffect(() => {
    setFailedScreencastTokens(new Set());
    setDismissedScreencastItems(new Set());
    setLastScreencastScreenshot(null);
    setActiveScreencast(null);
  }, [control.thread?.id]);

  // Clear the composer once a new user message is added to the thread
  useEffect(() => {
    const items = (control.thread?.items || []) as ThreadItem[];
    if (!items.length) {
      lastUserMessageIdRef.current = null;
      return;
    }

    const lastUserMessage = [...items].reverse().find(item => item.type === 'user_message');
    if (!lastUserMessage) return;

    if (lastUserMessage.id !== lastUserMessageIdRef.current) {
      setInputValue('');
      setAttachments([]);
      lastUserMessageIdRef.current = lastUserMessage.id;
      // NOTE: Do NOT clear dismissedScreencastItems, failedScreencastTokens, or lastScreencastScreenshot here!
      // Clearing them creates a race condition: the old dismissed/failed workflow gets retried
      // BEFORE the new workflow arrives. New workflows will have new IDs/tokens anyway.
      // lastScreencastScreenshot is associated with a specific itemId, so it won't show on wrong workflows.
      // These are only cleared when the thread changes (see useEffect with control.thread?.id).
    }
  }, [control.thread?.items]);

  // Keep ref in sync with state
  useEffect(() => {
    activeScreencastRef.current = activeScreencast;
  }, [activeScreencast]);

  // Conserver le dernier screencast actif jusqu'à ce qu'un nouveau arrive ou qu'il se déconnecte
  useEffect(() => {
    const items = control.thread?.items || [];
    const workflows = items.filter((i: any) => i.type === 'workflow');
    const lastWorkflow = workflows[workflows.length - 1];

    // Use ref to avoid re-running this effect when activeScreencast changes
    const currentActiveScreencast = activeScreencastRef.current;

    // First pass: find ALL computer_use tasks across all workflows
    // A single workflow can have multiple computer_use tasks (multiple screencasts)
    const allComputerUseTasks: Array<{
      item: any;
      task: any;
      taskIndex: number;
      workflowIndex: number;
      isLoading: boolean;
      isTerminal: boolean;
    }> = [];

    workflows.forEach((item: any, workflowIdx: number) => {
      if (dismissedScreencastItems.has(item.id)) {
        return;
      }

      // Collect ALL computer_use tasks from this workflow, not just the first one
      const tasks = item.workflow?.tasks || [];
      tasks.forEach((task: any, taskIdx: number) => {
        if (task.type !== 'computer_use') return;

        const isLoading = task.status_indicator === 'loading';
        const isComplete = task.status_indicator === 'complete';
        const isError = task.status_indicator === 'error';
        const isTerminal = isComplete || isError;

        allComputerUseTasks.push({
          item,
          task,
          taskIndex: taskIdx,
          workflowIndex: workflowIdx,
          isLoading,
          isTerminal,
        });
      });
    });

    // Get the latest (most recent) computer_use task
    const latestComputerUseEntry = allComputerUseTasks[allComputerUseTasks.length - 1];
    const latestComputerUseTask = latestComputerUseEntry
      ? { itemId: latestComputerUseEntry.item.id, token: latestComputerUseEntry.task.debug_url_token, status: latestComputerUseEntry.task.status_indicator }
      : null;

    let newActiveScreencast: { token: string; itemId: string } | null = null;
    let currentScreencastIsComplete = false;

    // Second pass: determine the active screencast
    // IMPORTANT: Only consider the LATEST computer_use task (across all workflows) to avoid older ones blocking newer ones
    // ALSO: If ANY workflow exists after the computer_use task's workflow, the task is considered done
    // ALSO: If there's a newer task in the SAME workflow, the older task is considered done
    allComputerUseTasks.forEach((cuEntry, index) => {
      const { item, task: computerUseTask, taskIndex, workflowIndex, isLoading, isTerminal } = cuEntry;
      const isLastComputerUseTask = index === allComputerUseTasks.length - 1;
      const isLastWorkflow = lastWorkflow && lastWorkflow.id === item.id;
      const isLastWorkflowAndStreaming = isLastWorkflow && control.isLoading;

      // Check if there's ANY workflow after this one (not just computer_use workflows)
      // If so, this computer_use task should be considered done
      const hasNewerWorkflow = workflowIndex >= 0 && workflowIndex < workflows.length - 1;

      // Check if there's a newer computer_use task (either in a later workflow or later in the same workflow)
      const hasNewerComputerUseTask = index < allComputerUseTasks.length - 1;

      // Consider task as "done" if it's terminal OR if there's a newer workflow OR if there's a newer computer_use task
      const isEffectivelyDone = isTerminal || hasNewerWorkflow || hasNewerComputerUseTask;

      // Si cette tâche est le screencast actuellement actif ET qu'elle est done, on doit le fermer
      if (isEffectivelyDone && currentActiveScreencast && computerUseTask.debug_url_token === currentActiveScreencast.token) {
        currentScreencastIsComplete = true;
      }

      // ONLY select the LATEST computer_use task as the active screencast
      // This prevents older tasks (even in the same workflow) from blocking newer ones
      // Also skip tokens that have failed connection to prevent reactivation loops
      // Also skip if there's a newer workflow or task after this one
      if (isLastComputerUseTask && computerUseTask.debug_url_token && !isEffectivelyDone &&
          !failedScreencastTokens.has(computerUseTask.debug_url_token)) {
        // Select if it's loading OR if it's the last workflow while streaming
        if (isLoading || isLastWorkflowAndStreaming) {
          newActiveScreencast = {
            token: computerUseTask.debug_url_token,
            itemId: item.id,
          };
        }
      }
    });

    // If the current screencast token is not the latest computer_use task's token, it should be closed
    // This handles the case where an older task is stuck in "loading" but a newer one has started
    if (currentActiveScreencast && latestComputerUseTask &&
        currentActiveScreencast.token !== latestComputerUseTask.token) {
      currentScreencastIsComplete = true;
    }

    // If the current screencast's token has failed, close it immediately
    if (currentActiveScreencast && failedScreencastTokens.has(currentActiveScreencast.token)) {
      currentScreencastIsComplete = true;
    }

    const latestComputerUseIsTerminal = latestComputerUseEntry?.isTerminal ?? false;
    const hasLoadingComputerUse = allComputerUseTasks.some(t => t.isLoading);

    // Mise à jour de activeScreencast :
    // - Si le screencast ACTUEL est complete OU s'il y a un computer_use complete, on ferme d'abord
    // - Sinon, si on trouve un nouveau screencast actif différent de l'actuel, on le met à jour
    // - Si aucun nouveau screencast actif n'est trouvé et pas de complete, on GARDE l'ancien (persistance)

    // Priorité 1: Fermer le screencast si nécessaire
    if (currentScreencastIsComplete || (latestComputerUseIsTerminal && !newActiveScreencast && !hasLoadingComputerUse)) {
      if (currentActiveScreencast) {
        setActiveScreencast(null);
      }
      // Only clear the screenshot when the task's ACTUAL status_indicator is terminal
      // NOT just because there's a newer workflow (which would lose the image in history)
      // The display logic already handles not showing screenshots for terminal tasks
      if (lastScreencastScreenshot) {
        const screenshotWorkflow = workflows.find((w: any) => w.id === lastScreencastScreenshot.itemId);
        const screenshotTask = screenshotWorkflow?.workflow?.tasks?.find((t: any) => t.type === 'computer_use');
        if (screenshotTask) {
          const isActuallyTerminal = screenshotTask.status_indicator === 'complete' || screenshotTask.status_indicator === 'error';
          if (isActuallyTerminal) {
            setLastScreencastScreenshot(null);
          }
        }
      }
    }
    // Priorité 2: Activer un nouveau screencast seulement s'il est différent de l'actuel (token OU itemId)
    else if (newActiveScreencast &&
             (newActiveScreencast.token !== currentActiveScreencast?.token ||
              newActiveScreencast.itemId !== currentActiveScreencast?.itemId)) {
      setActiveScreencast(newActiveScreencast);
    }
  }, [control.isLoading, control.thread?.items, dismissedScreencastItems, failedScreencastTokens, lastScreencastScreenshot]);

  // Callback pour le dernier frame du screencast
  // Note: Screenshots are now captured and emitted by the backend
  const handleScreencastLastFrame = useCallback((itemId: string) => {
    return (_frameDataUrl: string) => {
      // Screenshot is now emitted by backend, no need to store it here
    };
  }, []);

  // Ajuster le décalage du clavier virtuel sur mobile pour ne déplacer que le composer
  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const viewport = window.visualViewport;

    const updateKeyboardOffset = () => {
      const heightDiff = window.innerHeight - viewport.height;
      const offsetTop = viewport.offsetTop ?? 0;
      const offset = Math.max(0, heightDiff - offsetTop);
      setKeyboardOffset(offset);
    };

    updateKeyboardOffset();
    viewport.addEventListener('resize', updateKeyboardOffset);
    viewport.addEventListener('scroll', updateKeyboardOffset);

    return () => {
      viewport.removeEventListener('resize', updateKeyboardOffset);
      viewport.removeEventListener('scroll', updateKeyboardOffset);
    };
  }, []);

  // Conserver la portion visible du chat lorsque le clavier ajuste le viewport
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const delta = keyboardOffset - previousKeyboardOffsetRef.current;
    if (delta !== 0) {
      container.scrollTop += delta;
      previousKeyboardOffsetRef.current = keyboardOffset;
    }
  }, [keyboardOffset]);

  // Callback pour la soumission du Composer
  const handleComposerSubmit = useCallback(async (message: string, uploadedAttachments: Attachment[]) => {
    // Construire le contenu du message
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

    // Envoyer le message
    await control.sendMessage(content);

    // Réinitialiser le formulaire
    setInputValue('');
    setAttachments([]);
  }, [control]);

  const handlePromptClick = (prompt: string) => {
    control.sendMessage(prompt);
  };

  // Créer un nouveau thread
  const handleNewThread = () => {
    if (options.onThreadChange) {
      options.onThreadChange({ threadId: null });
    }
  };

  // Sélectionner un thread de l'historique
  const handleThreadSelect = (threadId: string) => {
    if (options.onThreadChange) {
      options.onThreadChange({ threadId });
    }
  };

  const handleThreadDeleted = (threadId: string) => {
    if (options.onThreadChange && control.thread?.id === threadId) {
      options.onThreadChange({ threadId: null });
    }
  };

  // Copier le contenu d'un message
  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), COPY_FEEDBACK_DELAY_MS);
  };

  const inlineVoiceWidget = useMemo<VoiceSessionWidget | null>(() => {
    const voiceSession = options.widgets?.voiceSession;
    if (!voiceSession || voiceSession.enabled === false) {
      return null;
    }

    const threadId = control.thread?.id ?? null;
    const voiceThreadMatches = !voiceSession.threadId || voiceSession.threadId === threadId;
    if (!voiceThreadMatches) {
      return null;
    }

    return {
      type: 'VoiceSession',
      title: 'Voix',
      description: "Contrôlez l'écoute et consultez les transcriptions en temps réel.",
      startLabel: 'Démarrer',
      stopLabel: 'Arrêter',
      showTranscripts: true,
      ...(options.widgets.voiceSessionWidget ?? {}),
    };
  }, [control.thread?.id, options.widgets?.voiceSession, options.widgets?.voiceSessionWidget]);

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

  const renderInlineWidgets = (
    widget: VoiceSessionWidget | null,
    context: WidgetContext,
  ): React.ReactNode => {
    if (!widget) {
      return null;
    }

    return (
      <div className="chatkit-inline-widgets">
        <WidgetRenderer widget={widget} context={context} />
      </div>
    );
  };

  // Créer un callback pour gérer les actions de widgets
  const createWidgetContext = useCallback((itemId: string): WidgetContext => ({
    onAction: (actionConfig: ActionConfig) => {
      // Convert ActionConfig to Action format expected by customAction
      // ActionConfig structure: { type, payload, handler?, loadingBehavior? }
      // handler and loadingBehavior are ActionConfig properties, NOT part of payload
      const { type, payload, handler, loadingBehavior, ...rest } = actionConfig;

      // Collect form data if available
      const formData = formDataRef.current ? Object.fromEntries(formDataRef.current.entries()) : {};

      // Build the payload combining all data sources
      // The payload is stored as-is in raw_payload, so data should be at root level
      // for workflow access via input.action.raw_payload.fieldName
      const actionPayload = {
        ...(payload || {}),
        ...formData,
        ...rest, // Include any extra properties that aren't ActionConfig metadata
      };

      const action = {
        type,
        // Use 'data' for frontend Action type, will be converted to 'payload' by API
        data: actionPayload,
      };

      // Clear form data after use
      formDataRef.current = null;
      // Send the action to the backend
      control.customAction(itemId, action);
    },
    onFormData: (data: FormData) => {
      // Store form data to be included in the next action
      formDataRef.current = data;
    },
    voiceSession: options.widgets?.voiceSession,
  }), [control, options.widgets?.voiceSession]);

  // Afficher le start screen si pas de messages ET qu'on n'est pas en train de charger
  const showStartScreen = !control.isLoading && (!control.thread || control.thread.items.length === 0);

  // Vérifier si le thread est fermé ou verrouillé
  const threadStatus = control.thread?.status;
  const isThreadClosed = threadStatus?.type === 'closed';
  const isThreadLocked = threadStatus?.type === 'locked';
  const isThreadDisabled = isThreadClosed || isThreadLocked;
  const threadStatusMessage = isThreadDisabled
    ? (threadStatus?.reason || (isThreadClosed ? t('chatkit.thread.closed') : t('chatkit.thread.locked')))
    : null;

  // Récupérer le titre du thread
  const getThreadTitle = (): string => {
    if (showStartScreen) {
      return '';
    }

    if (!control.thread) {
      return t('chatkit.thread.newConversation');
    }

    if (control.thread.title) {
      return control.thread.title;
    }

    return t('chatkit.thread.conversation');
  };

  return (
    <div
      className={`chatkit ${className || ''}`}
      style={{
        ...style,
        ['--chatkit-keyboard-offset' as const]: `${keyboardOffset}px`,
      }}
      data-theme={theme?.colorScheme}
    >
      {/* Header */}
      {header !== false && header?.enabled !== false && (
        <div className="chatkit-header">
          {header?.leftAction && (
            <button
              className="chatkit-header-action"
              onClick={header.leftAction.onClick}
              aria-label={header.leftAction.icon}
            >
              {header.leftAction.icon === 'menu' ? (
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="3" y1="12" x2="21" y2="12"></line>
                  <line x1="3" y1="6" x2="21" y2="6"></line>
                  <line x1="3" y1="18" x2="21" y2="18"></line>
                </svg>
              ) : header.leftAction.icon}
            </button>
          )}
          <div className="chatkit-header-title">{getThreadTitle()}</div>
          <div className="chatkit-header-actions">
            <button
              className="chatkit-header-action"
              disabled={showStartScreen}
              onClick={handleNewThread}
              aria-label="Nouvelle conversation"
              title="Nouvelle conversation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14"></path>
              </svg>
            </button>
            {history?.enabled !== false && (
              <button
                className="chatkit-header-action"
                onClick={() => setShowHistory(!showHistory)}
                aria-label="Historique"
                title="Historique des conversations"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10"></circle>
                  <polyline points="12 6 12 12 16 14"></polyline>
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="chatkit-messages" ref={messagesContainerRef}>
        {showStartScreen && startScreen ? (
          <div className="chatkit-start-screen">
            {startScreen.greeting && (
              <div className="chatkit-start-greeting">{startScreen.greeting}</div>
            )}
            {startScreen.prompts && startScreen.prompts.length > 0 && (
              <div className="chatkit-start-prompts">
                {startScreen.prompts.map((prompt, idx) => (
                  <button
                    key={idx}
                    className="chatkit-start-prompt"
                    onClick={() => handlePromptClick(prompt.prompt)}
                  >
                    {prompt.icon && <span className="chatkit-prompt-icon">{prompt.icon}</span>}
                    <span>{prompt.label}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          (() => {
            const items = control.thread?.items || [];
            const inlineVoiceElement = inlineVoiceWidget
              ? renderInlineWidgets(inlineVoiceWidget, createWidgetContext('inline-voice'))
              : null;
            let hasInsertedInlineVoice = false;

            const inlineVoiceAfterItem = (candidate: ThreadItem, idx: number): boolean => {
              if (!inlineVoiceElement || hasInsertedInlineVoice) {
                return false;
              }

              if (candidate.type === 'user_message') {
                return true;
              }

              const isLastItem = idx === items.length - 1;
              return isLastItem;
            };

            const renderedItems = items.flatMap((item, idx) => {
              // Ne pas afficher end_of_turn
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

              const nodes: React.ReactNode[] = [
                (
                  <div
                    key={item.id}
                    className={`chatkit-message chatkit-message-${messageClass} chatkit-item-${item.type}`}
                  >
                  {/* User message */}
                  {item.type === 'user_message' && (
                    <div className="chatkit-message-content">
                    {item.content.map((content, idx) => (
                      <div key={idx}>
                        {content.type === 'input_text' && <MarkdownRenderer content={content.text} theme={theme?.colorScheme} />}
                        {content.type === 'input_tag' && (
                          <span className="chatkit-tag">{content.text}</span>
                        )}
                        {content.type === 'image' && <ImageWithBlobUrl src={content.image} alt="" />}
                        {content.type === 'file' && (
                          <div className="chatkit-file">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                              <polyline points="14 2 14 8 20 8"></polyline>
                            </svg>
                            {content.file}
                          </div>
                        )}
                      </div>
                    ))}
                    {item.quoted_text && (
                      <div className="chatkit-quoted-text">
                        <blockquote>{item.quoted_text}</blockquote>
                      </div>
                    )}
                  </div>
                )}

                {/* Assistant message */}
                {item.type === 'assistant_message' && (
                  <>
                    <div className="chatkit-message-content">
                      {item.content
                        .filter((content) => {
                          if (content.type !== 'output_text') {
                            return true;
                          }

                          const rawText = content.text ?? '';
                          return !isLikelyJson(rawText);
                        })
                        .map((content, idx) => (
                          <div key={idx}>
                            {content.type === 'output_text' && (
                              <>
                                <MarkdownRenderer content={content.text} theme={theme?.colorScheme} />
                                {content.annotations && content.annotations.length > 0 && (
                                  <AnnotationRenderer annotations={content.annotations} />
                                )}
                              </>
                            )}
                          {content.type === 'widget' && (
                            <WidgetRenderer widget={content.widget} context={createWidgetContext(item.id)} />
                          )}
                        </div>
                        ))}
                      {item.status === 'in_progress' && <LoadingIndicator label={t('chat.loading')} />}
                    </div>
                    {item.status !== 'in_progress' && (
                      <button
                        className={`chatkit-copy-button ${copiedMessageId === item.id ? 'copied' : ''}`}
                        onClick={() => {
                          const textContent = item.content
                            .filter((c: any) => c.type === 'output_text')
                            .map((c: any) => c.text)
                            .join('\n\n');
                          handleCopyMessage(item.id, textContent);
                        }}
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
                    )}
                  </>
                )}

                {/* Client tool call */}
                {item.type === 'client_tool_call' && (
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
                )}

                {/* Widget standalone */}
                {item.type === 'widget' && (
                  <div className="chatkit-message-content">
                    <WidgetRenderer widget={item.widget} context={createWidgetContext(item.id)} />
                  </div>
                )}

                {/* Task standalone */}
                {(() => {
                  if (item.type !== 'task') {
                    return null;
                  }

                  const task = item.task as any;
                  const hasJsonContent =
                    task?.type === 'custom' && typeof task?.content === 'string' && isLikelyJson(task.content);

                  if (hasJsonContent) {
                    // Hide opaque payloads entirely from the transcript while keeping any accompanying widgets/metadata
                    return null;
                  }

                  const sanitizedTask = task;

                  return (
                    <div className="chatkit-message-content">
                      <TaskRenderer task={sanitizedTask} theme={theme?.colorScheme} />
                    </div>
                  );
                })()}

                  {/* Workflow */}
                  {item.type === 'workflow' && (
                  <>
                    {/* Always show workflow header - completion is handled by backend */}
                    <div className="chatkit-message-content">
                      <WorkflowRenderer workflow={item.workflow} theme={theme?.colorScheme} />
                    </div>

                    {/* Afficher les images (partielles ou finales) après le workflow */}
                    {(() => {
                      const imageTask = item.workflow.tasks.find(
                        (task: any) => task.type === 'image'
                      );
                      if (imageTask && imageTask.images && imageTask.images.length > 0) {
                        const image = imageTask.images[0];
                        const isLoading = imageTask.status_indicator === 'loading';

                        // Afficher le partial pendant le loading
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
                              />
                            </div>
                          );
                        }

                        // Afficher l'image finale
                        if (!isLoading) {
                          let src = image.data_url || image.image_url || (image.b64_json ? `data:image/png;base64,${image.b64_json}` : '');
                          // Ensure proper data URL format
                          if (src && !src.startsWith('data:') && !src.startsWith('http')) {
                            src = `data:image/png;base64,${src}`;
                          }
                          if (src) {
                            return <FinalImageDisplay src={src} />;
                          }
                        }
                      }
                      return null;
                    })()}

                    {/* Afficher les screenshots du browser automation (computer_use) */}
                    {(() => {
                      // Find the computer_use task that is currently loading with a debug token,
                      // or the last computer_use task with a debug token, or the last computer_use task
                      const computerUseTasks = item.workflow.tasks.filter(
                        (task: any) => task.type === 'computer_use'
                      );

                      let computerUseTask = computerUseTasks.find(
                        (task: any) => task.status_indicator === 'loading' && task.debug_url_token
                      );

                      if (!computerUseTask) {
                        // Find last task with debug_url_token
                        const tasksWithToken = computerUseTasks.filter((task: any) => task.debug_url_token);
                        computerUseTask = tasksWithToken[tasksWithToken.length - 1];
                      }

                      if (!computerUseTask && computerUseTasks.length > 0) {
                        // Fallback to last computer_use task
                        computerUseTask = computerUseTasks[computerUseTasks.length - 1];
                      }

                      if (computerUseTask) {
                        const hasScreenshots = computerUseTask.screenshots && computerUseTask.screenshots.length > 0;
                        const screenshot = hasScreenshots ? computerUseTask.screenshots[computerUseTask.screenshots.length - 1] : null;
                        // Check if THIS SPECIFIC task is loading (not the workflow)
                        const isLoading = computerUseTask.status_indicator === 'loading';

                        let src = screenshot ? (screenshot.data_url || (screenshot.b64_image ? `data:image/png;base64,${screenshot.b64_image}` : '')) : '';

                        // Ensure proper data URL format for screenshot
                        if (src && !src.startsWith('data:') && !src.startsWith('http')) {
                          src = `data:image/png;base64,${src}`;
                        }

                        // Vérifier si ce workflow contient le screencast actuellement actif
                        const debugUrlToken =
                          computerUseTask.debug_url_token ||
                          (activeScreencast?.itemId === item.id ? activeScreencast.token : undefined);

                        const isActiveScreencast = activeScreencast?.itemId === item.id && !!debugUrlToken;

                        // Afficher le screencast live seulement si c'est le screencast actif
                        const showLiveScreencast = isActiveScreencast && !!debugUrlToken;

                        // Si on n'a pas de screenshot mais qu'on a un screenshot sauvegardé pour ce workflow, l'utiliser
                        if (!src && lastScreencastScreenshot && lastScreencastScreenshot.itemId === item.id) {
                          src = lastScreencastScreenshot.src;
                        }

                        // Afficher la screenshot si on a une screenshot ET qu'on n'affiche pas le screencast live
                        // MAIS seulement si la tâche n'est pas complete (sinon on cache tout pour retourner au début)
                        const isComplete = computerUseTask.status_indicator === 'complete';
                        const isError = computerUseTask.status_indicator === 'error';
                        const isTerminal = isComplete || isError;
                        const showScreenshot = !!src && !showLiveScreencast && !isTerminal;

                        const isDismissed = dismissedScreencastItems.has(item.id);
                        // If dismissed, only hide the live screencast, but still show static screenshot
                        const shouldShowLiveScreencast = showLiveScreencast && !isDismissed;
                        const shouldShowScreenshot = showScreenshot;
                        const showPreview = shouldShowLiveScreencast || shouldShowScreenshot;
                        // If dismissed, don't show loading animation on screenshot
                        const screenshotIsLoading = isLoading && !isDismissed;

                        let actionTitle = computerUseTask.current_action || screenshot?.action_description;
                        // Si on utilise le screenshot sauvegardé, utiliser son action
                        if (!screenshot && lastScreencastScreenshot && lastScreencastScreenshot.itemId === item.id) {
                          actionTitle = actionTitle || lastScreencastScreenshot.action;
                        }
                        const clickPosition = screenshot?.click_position || screenshot?.click;

                        const toPercent = (value: number): number => {
                          const scaled = value <= 1 ? value * 100 : value;
                          return Math.min(100, Math.max(0, scaled));
                        };

                        const clickCoordinates = clickPosition
                          ? {
                              x: toPercent(clickPosition.x),
                              y: toPercent(clickPosition.y),
                            }
                          : null;

                        if (showPreview) {
                          const handleEndSession = () => {
                            // Note: Screenshot is captured and workflow completion is handled
                            // by the backend in _handle_continue_workflow (server.py)

                            // Close the active screencast
                            setActiveScreencast(current =>
                              current?.itemId === item.id ? null : current
                            );

                            // Trigger workflow continuation
                            control.customAction(null, { type: 'continue_workflow' });
                          };

                          return (
                            <div className="chatkit-computer-use-preview">
                              {actionTitle && (
                                <div className="chatkit-computer-action-title">{actionTitle}</div>
                              )}
                              {/* Show screencast if this is the active screencast */}
                              {shouldShowLiveScreencast && (
                                <>
                                  <DevToolsScreencast
                                    debugUrlToken={debugUrlToken as string}
                                    authToken={authToken}
                                    enableInput
                                    onConnectionError={() => {
                                      // Mark this token as failed to prevent reactivation loops
                                      setFailedScreencastTokens(prev => {
                                        if (prev.has(debugUrlToken as string)) return prev;
                                        const next = new Set(prev);
                                        next.add(debugUrlToken as string);
                                        return next;
                                      });
                                      setActiveScreencast(current =>
                                        current?.token === debugUrlToken ? null : current
                                      );
                                    }}
                                    onLastFrame={handleScreencastLastFrame(item.id)}
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
                              {/* Show screenshot for completed tasks or non-active screencasts */}
                              {shouldShowScreenshot && (
                                <div className="chatkit-browser-screenshot-container">
                                  <div className="chatkit-browser-screenshot-image-wrapper">
                                    <ImageWithBlobUrl
                                      src={src}
                                      alt={actionTitle || "Browser automation"}
                                      className={screenshotIsLoading ? "chatkit-browser-screenshot chatkit-browser-screenshot--loading" : "chatkit-browser-screenshot"}
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
                  )}
                  </div>
                ),
              ];

              if (inlineVoiceAfterItem(item, idx)) {
                hasInsertedInlineVoice = true;
                nodes.push(
                  <React.Fragment key={`inline-voice-${item.id}`}>
                    {inlineVoiceElement}
                  </React.Fragment>,
                );
              }

              return nodes;
            });

            if (inlineVoiceElement && !hasInsertedInlineVoice) {
              renderedItems.push(
                <React.Fragment key="inline-voice-tail">{inlineVoiceElement}</React.Fragment>,
              );
            }

            return renderedItems;
          })()
        )}

        {/* Loading indicator */}
        {(() => {
          const items = control.thread?.items || [];
          const lastItem = items[items.length - 1];
          const isWaitingForAssistant = control.isLoading && (!lastItem || lastItem.type === 'user_message');

          if (!isWaitingForAssistant) {
            return null;
          }

          return (
            <div className="chatkit-message chatkit-message-assistant">
              <div className="chatkit-message-content">
                <div className="chatkit-workflow-loading">
                  <div className="chatkit-workflow-loading-spinner"></div>
                </div>
              </div>
            </div>
          );
        })()}

        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {control.error && (
        <div className="chatkit-error">
          <strong>Erreur:</strong> {control.error.message}
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
      />

      {/* Thread History Modal */}
      {showHistory && (
          <ThreadHistory
            api={options.api}
            currentThreadId={control.thread?.id || null}
            loadingThreadIds={control.loadingThreadIds}
            onThreadSelect={handleThreadSelect}
            onThreadDeleted={handleThreadDeleted}
            onClose={() => setShowHistory(false)}
          />
        )}
    </div>
  );
}
