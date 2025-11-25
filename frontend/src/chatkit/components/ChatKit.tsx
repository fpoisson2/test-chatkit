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
import { ThreadHistory } from './ThreadHistory';
import { Composer } from './Composer';
import { MessageRenderer } from './MessageRenderer';
import { useI18n } from '../../i18n/I18nProvider';
import { useScreencast } from '../hooks/useScreencast';
import type { Attachment } from '../api/attachments';
import { COPY_FEEDBACK_DELAY_MS } from '../utils';
import './ChatKit.css';

export interface ChatKitProps {
  control: ChatKitControl;
  options: ChatKitOptions;
  className?: string;
  style?: React.CSSProperties;
}

export function ChatKit({ control, options, className, style }: ChatKitProps): JSX.Element {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const previousKeyboardOffsetRef = useRef(0);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const formDataRef = useRef<FormData | null>(null);

  // Screencast management hook
  const {
    activeScreencast,
    setActiveScreencast,
    lastScreencastScreenshot,
    dismissedScreencastItems,
    failedScreencastTokens,
    handleScreencastLastFrame,
    handleScreencastConnectionError,
  } = useScreencast({
    threadId: control.thread?.id,
    threadItems: (control.thread?.items || []) as ThreadItem[],
    isLoading: control.isLoading,
  });

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
    }
  }, [control.thread?.items]);

  // Callback to continue workflow
  const handleContinueWorkflow = useCallback(() => {
    control.customAction(null, { type: 'continue_workflow' });
  }, [control]);

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

              const nodes: React.ReactNode[] = [
                <MessageRenderer
                  key={item.id}
                  item={item}
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
                  onScreencastLastFrame={handleScreencastLastFrame}
                  onScreencastConnectionError={handleScreencastConnectionError}
                  onActiveScreencastChange={setActiveScreencast}
                  onContinueWorkflow={handleContinueWorkflow}
                />,
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
