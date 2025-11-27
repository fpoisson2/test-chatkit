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
  OutboundCallWidget,
} from '../types';
import { WidgetRenderer } from '../widgets';
import type { WidgetContext } from '../widgets';
import { Composer } from './Composer';
import { MessageRenderer } from './MessageRenderer';
import { Header } from './Header';
import { useI18n } from '../../i18n/I18nProvider';
import { useScreencast } from '../hooks/useScreencast';
import type { Attachment } from '../api/attachments';
import { createAttachment, createFilePreview, generateAttachmentId, uploadAttachment, validateFile } from '../api/attachments';
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
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const previousKeyboardOffsetRef = useRef(0);
  const lastUserMessageIdRef = useRef<string | null>(null);
  const formDataRef = useRef<FormData | null>(null);
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const dragCounterRef = useRef(0);
  const attachmentsRef = useRef<Attachment[]>([]);

  useEffect(() => {
    attachmentsRef.current = attachments;
  }, [attachments]);

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


  const handleFilesSelected = useCallback(async (files: FileList | null) => {
    if (!attachmentsConfig?.enabled || !files || files.length === 0) {
      return;
    }

    const filesArray = Array.from(files);
    const newAttachments: Attachment[] = [];

    for (const file of filesArray) {
      if (attachmentsConfig.maxCount && attachmentsRef.current.length + newAttachments.length >= attachmentsConfig.maxCount) {
        break;
      }

      const validation = validateFile(file, attachmentsConfig);
      if (!validation.valid) {
        console.error(`[ChatKit] File validation failed: ${validation.error}`);
        continue;
      }

      const localId = generateAttachmentId();
      const preview = await createFilePreview(file);
      const type = file.type.startsWith('image/') ? 'image' : 'file';

      newAttachments.push({
        id: localId,
        file,
        type,
        preview: preview || undefined,
        status: 'pending',
        progress: 0,
      });
    }

    if (newAttachments.length === 0) {
      return;
    }

    // Add attachments immediately with pending status
    const updatedAttachments = [...attachmentsRef.current, ...newAttachments];
    setAttachments(updatedAttachments);

    // Start uploading each file immediately if API is configured
    if (api?.url) {
      for (const att of newAttachments) {
        // Update status to uploading
        setAttachments(prev => prev.map(a =>
          a.id === att.id ? { ...a, status: 'uploading' as const, progress: 0 } : a
        ));

        try {
          // Phase 1: Create attachment to get backend ID and upload URL
          const createResponse = await createAttachment({
            url: api.url,
            headers: api.headers,
            name: att.file.name,
            size: att.file.size,
            mimeType: att.file.type || 'application/octet-stream',
          });

          const backendId = createResponse.id;
          const uploadUrl = createResponse.upload_url;

          // Phase 2: Upload the file with progress tracking
          await uploadAttachment({
            url: api.url,
            headers: api.headers,
            attachmentId: backendId,
            file: att.file,
            uploadUrl: uploadUrl,
            onProgress: (progress) => {
              setAttachments(prev => prev.map(a =>
                a.id === att.id ? { ...a, progress: Math.round(progress) } : a
              ));
            },
          });

          // Update with backend ID and mark as uploaded
          setAttachments(prev => prev.map(a =>
            a.id === att.id ? {
              ...a,
              id: backendId,
              status: 'uploaded' as const,
              progress: 100,
              uploadUrl: uploadUrl,
            } : a
          ));
        } catch (err) {
          console.error('[ChatKit] Failed to upload attachment:', err);
          // Parse error message for user-friendly display
          let errorMessage = 'Échec de l\'upload';
          const errString = String(err);
          if (errString.includes('413') || errString.includes('Request Entity Too Large')) {
            errorMessage = 'Fichier trop volumineux (limite serveur dépassée)';
          } else if (errString.includes('Network error') || errString.includes('Failed to fetch')) {
            errorMessage = 'Erreur réseau';
          } else if (errString.includes('401') || errString.includes('403')) {
            errorMessage = 'Non autorisé';
          }
          setAttachments(prev => prev.map(a =>
            a.id === att.id ? { ...a, status: 'error' as const, error: errorMessage } : a
          ));
        }
      }
    }
  }, [attachmentsConfig, api?.url, api?.headers]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!attachmentsEnabled) return;

    dragCounterRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) {
      setIsDraggingFiles(true);
    }
  }, [attachmentsEnabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!attachmentsEnabled) return;

    dragCounterRef.current = Math.max(0, dragCounterRef.current - 1);
    if (dragCounterRef.current === 0) {
      setIsDraggingFiles(false);
    }
  }, [attachmentsEnabled]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!attachmentsEnabled) return;
  }, [attachmentsEnabled]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    if (!attachmentsEnabled) return;

    dragCounterRef.current = 0;
    setIsDraggingFiles(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  }, [attachmentsEnabled, handleFilesSelected]);

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

  const inlineOutboundCallWidget = useMemo<OutboundCallWidget | null>(() => {
    const outboundCall = options.widgets?.outboundCall;
    if (!outboundCall || outboundCall.enabled === false) {
      return null;
    }

    // Only show when there's an active call
    if (!outboundCall.isActive && outboundCall.status === 'idle') {
      return null;
    }

    return {
      type: 'OutboundCall',
      title: 'Appel sortant',
      description: "Appel en cours. Les transcriptions apparaissent ci-dessous.",
      hangupLabel: 'Raccrocher',
      showTranscripts: true,
      showAudioPlayer: false, // Audio player is rendered separately
      ...(options.widgets.outboundCallWidget ?? {}),
    };
  }, [options.widgets?.outboundCall, options.widgets?.outboundCallWidget]);

  const renderInlineWidgets = (
    voiceWidget: VoiceSessionWidget | null,
    outboundCallWidgetProp: OutboundCallWidget | null,
    context: WidgetContext,
  ): React.ReactNode => {
    if (!voiceWidget && !outboundCallWidgetProp) {
      return null;
    }

    return (
      <div className="chatkit-inline-widgets">
        {voiceWidget && <WidgetRenderer widget={voiceWidget} context={context} />}
        {outboundCallWidgetProp && <WidgetRenderer widget={outboundCallWidgetProp} context={context} />}
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
    outboundCall: options.widgets?.outboundCall,
  }), [control, options.widgets?.voiceSession, options.widgets?.outboundCall]);

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

  // Récupérer le nom du workflow d'origine
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
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {isDraggingFiles && attachmentsEnabled && (
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
        onFilesSelected={handleFilesSelected}
        isDraggingFiles={isDraggingFiles}
      />

    </div>
  );
}
