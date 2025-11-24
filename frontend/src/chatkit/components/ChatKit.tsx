/**
 * Composant ChatKit complet avec toutes les fonctionnalités
 */
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type {
  ChatKitControl,
  ChatKitOptions,
  StartScreenPrompt,
  ThreadItem,
  ActionConfig,
  ComposerModel,
  UserMessageContent,
} from '../types';
import { WidgetRenderer } from '../widgets';
import type { WidgetContext } from '../widgets';
import { WorkflowRenderer } from './WorkflowRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AnnotationRenderer } from './AnnotationRenderer';
import { ThreadHistory } from './ThreadHistory';
import { MarkdownRenderer } from './MarkdownRenderer';
import { DevToolsScreencast } from './DevToolsScreencast';
import { useI18n } from '../../i18n/I18nProvider';
import { LoadingIndicator } from './LoadingIndicator';
import {
  Attachment,
  uploadAttachment,
  createFilePreview,
  generateAttachmentId,
  validateFile
} from '../api/attachments';
import './ChatKit.css';

export interface ChatKitProps {
  control: ChatKitControl;
  options: ChatKitOptions;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Component to display images with Blob URL conversion to avoid 414 errors
 */
function ImageWithBlobUrl({ src, alt = '', className = '' }: { src: string; alt?: string; className?: string }): JSX.Element | null {
  const [blobUrl, setBlobUrl] = useState<string>('');

  useEffect(() => {
    let objectUrl: string | null = null;

    if (src.startsWith('data:')) {
      // Convert data URL to blob to avoid 414 errors with very long URLs
      try {
        const parts = src.split(',');
        const mimeMatch = parts[0].match(/:(.*?);/);
        const mime = mimeMatch ? mimeMatch[1] : '';
        const bstr = atob(parts[1]);
        const n = bstr.length;
        const u8arr = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          u8arr[i] = bstr.charCodeAt(i);
        }
        const blob = new Blob([u8arr], { type: mime });
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.error('[ChatKit] Failed to convert data URL to blob:', err);
      }
    } else if (src.startsWith('http')) {
      // Regular URL, use as is
      setBlobUrl(src);
    } else {
      // Assume it's a raw base64 string, try to convert it
      try {
        const bstr = atob(src);
        const n = bstr.length;
        const u8arr = new Uint8Array(n);
        for (let i = 0; i < n; i++) {
          u8arr[i] = bstr.charCodeAt(i);
        }
        const blob = new Blob([u8arr], { type: 'image/png' });
        objectUrl = URL.createObjectURL(blob);
        setBlobUrl(objectUrl);
      } catch (err) {
        console.error('[ChatKit] Failed to convert raw base64 to blob:', err);
        // Fallback: treat as regular src
        setBlobUrl(src);
      }
    }

    return () => {
      if (objectUrl && objectUrl.startsWith('blob:')) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [src]);

  if (!blobUrl) return null;

  return <img src={blobUrl} alt={alt} className={className} />;
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
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const singleLineHeightRef = useRef<number | null>(null);
  const [isMultiline, setIsMultiline] = useState(false);
  const modeChangeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
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

  const composerModels = composer?.models;

  const availableModels = useMemo<ComposerModel[]>(() => {
    if (!composerModels) return [];
    return Array.isArray(composerModels)
      ? composerModels
      : composerModels.options || [];
  }, [composerModels]);

  const isModelSelectorEnabled = useMemo(
    () => !!composerModels && (Array.isArray(composerModels) || !!composerModels.enabled),
    [composerModels],
  );

  const [selectedModelId, setSelectedModelId] = useState<string | null>(null);

  useEffect(() => {
    if (!isModelSelectorEnabled || availableModels.length === 0) {
      setSelectedModelId(null);
      return;
    }

    const currentModelExists = availableModels.some((model) => model.id === selectedModelId);
    if (currentModelExists) return;

    const defaultModel = availableModels.find((model) => model.default) ?? availableModels[0];
    setSelectedModelId(defaultModel?.id ?? null);
  }, [availableModels, isModelSelectorEnabled, selectedModelId]);

  const inferenceOptions = useMemo(
    () => (isModelSelectorEnabled && selectedModelId ? { model: selectedModelId } : undefined),
    [isModelSelectorEnabled, selectedModelId],
  );

  const selectedModel = useMemo(
    () => availableModels.find((model) => model.id === selectedModelId),
    [availableModels, selectedModelId],
  );

  const sendMessageWithInference = useCallback(
    (content: UserMessageContent[] | string) =>
      control.sendMessage(content, inferenceOptions ? { inferenceOptions } : undefined),
    [control, inferenceOptions],
  );

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

  // Conserver le dernier screencast actif jusqu'à ce qu'un nouveau arrive ou qu'il se déconnecte
  useEffect(() => {
    const items = control.thread?.items || [];
    const workflows = items.filter((i: any) => i.type === 'workflow');
    const lastWorkflow = workflows[workflows.length - 1];

    console.log('[ChatKit useEffect] Checking for active screencast, control.isLoading:', control.isLoading, 'workflows:', workflows.length);

    let newActiveScreencast: { token: string; itemId: string } | null = null;
    let currentScreencastIsComplete = false;
    let anyCompleteComputerUse = false;

    // Parcourir tous les workflows pour trouver celui qui est actuellement actif
    workflows.forEach((item: any) => {
      const computerUseTask = item.workflow?.tasks?.find((t: any) => t.type === 'computer_use');
      if (!computerUseTask) return;

      const isLoading = computerUseTask.status_indicator === 'loading';
      const isComplete = computerUseTask.status_indicator === 'complete';
      const isLastWorkflow = lastWorkflow && lastWorkflow.id === item.id;
      const isLastWorkflowAndStreaming = isLastWorkflow && control.isLoading;

      console.log('[ChatKit useEffect] Workflow:', item.id, {
        hasToken: !!computerUseTask.debug_url_token,
        token: computerUseTask.debug_url_token?.substring(0, 8),
        isLoading,
        isComplete,
        isLastWorkflow,
        isLastWorkflowAndStreaming,
        isCurrentScreencast: activeScreencast?.itemId === item.id,
        willCapture: (isLoading || isLastWorkflowAndStreaming) && !!computerUseTask.debug_url_token && !isComplete
      });

      // Détecter si un workflow computer_use complete existe
      if (isComplete) {
        anyCompleteComputerUse = true;
      }

      // Si ce workflow est le screencast actuellement actif ET qu'il est complete, on doit le fermer
      if (isComplete && activeScreencast && item.id === activeScreencast.itemId) {
        currentScreencastIsComplete = true;
      }

      // Capturer le screencast s'il est actuellement actif (en cours de chargement ou dernier workflow pendant le streaming)
      // ET s'il a un debug_url_token ET qu'il n'est PAS complete
      if ((isLoading || isLastWorkflowAndStreaming) && computerUseTask.debug_url_token && !isComplete) {
        newActiveScreencast = {
          token: computerUseTask.debug_url_token,
          itemId: item.id,
        };
      }
    });

    console.log('[ChatKit useEffect] Result - newActiveScreencast:', newActiveScreencast, 'currentScreencastIsComplete:', currentScreencastIsComplete, 'anyCompleteComputerUse:', anyCompleteComputerUse, 'currentActiveScreencast:', activeScreencast);

    // Mise à jour de activeScreencast :
    // - Si le screencast ACTUEL est complete OU s'il y a un computer_use complete, on ferme d'abord
    // - Sinon, si on trouve un nouveau screencast actif différent de l'actuel, on le met à jour
    // - Si aucun nouveau screencast actif n'est trouvé et pas de complete, on GARDE l'ancien (persistance)

    // Priorité 1: Fermer le screencast s'il y a un computer_use task complete (empêche la boucle infinie)
    if (currentScreencastIsComplete || anyCompleteComputerUse) {
      if (activeScreencast) {
        console.log('[ChatKit] Closing screencast due to completed computer_use task');
        setActiveScreencast(null);
      }
      // Nettoyer aussi le dernier screenshot sauvegardé pour éviter qu'il persiste
      if (lastScreencastScreenshot && activeScreencast?.itemId === lastScreencastScreenshot.itemId) {
        console.log('[ChatKit] Clearing last screencast screenshot for completed task');
        setLastScreencastScreenshot(null);
      }
    }
    // Priorité 2: Activer un nouveau screencast seulement s'il n'y a PAS de computer_use complete
    else if (newActiveScreencast && newActiveScreencast.token !== activeScreencast?.token) {
      console.log('[ChatKit] Activating new screencast:', newActiveScreencast);
      setActiveScreencast(newActiveScreencast);
    }
  }, [activeScreencast?.token, control.isLoading, control.thread?.items]);

  // Callback pour capturer le dernier frame du screencast avant sa fermeture
  const handleScreencastLastFrame = useCallback((itemId: string) => {
    return (frameDataUrl: string) => {
      console.log('[ChatKit] Captured last screencast frame for item:', itemId, 'dataUrl length:', frameDataUrl.length);
      setLastScreencastScreenshot({
        itemId,
        src: frameDataUrl,
        action: undefined,
      });
      console.log('[ChatKit] lastScreencastScreenshot state updated');
    };
  }, []);

  // Debug: Logger les changements dans les items
  useEffect(() => {
    if (!control.thread?.items) return;

    console.log('[ChatKit] Thread items changed:', {
      count: control.thread.items.length,
      types: control.thread.items.map(item => item.type),
      lastItem: control.thread.items[control.thread.items.length - 1],
    });

    // Logger spécifiquement les workflows et leurs tâches
    control.thread.items.forEach((item, idx) => {
      if (item.type === 'workflow') {
        console.log(`[ChatKit] Workflow item ${idx}:`, {
          taskCount: item.workflow.tasks.length,
          taskTypes: item.workflow.tasks.map(t => t.type),
          tasks: item.workflow.tasks,
        });
      }
    });
  }, [control.thread?.items]);

  // Ajuster automatiquement la hauteur du textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    // Calculer la hauteur minimale basée sur le style réel du textarea
    const styles = window.getComputedStyle(textarea);
    const lineHeight = parseFloat(styles.lineHeight || '0');
    const paddingTop = parseFloat(styles.paddingTop || '0');
    const paddingBottom = parseFloat(styles.paddingBottom || '0');
    const minHeight = lineHeight + paddingTop + paddingBottom;

    if (singleLineHeightRef.current === null) {
      singleLineHeightRef.current = minHeight;
    }
    const baseHeight = singleLineHeightRef.current;

    // Pour détecter correctement le dépassement, mesurer avec la largeur du mode SINGLE-LINE
    // pour le premier passage en multiline, puis utiliser la largeur effective en mode multiline
    const form = textarea.closest('.chatkit-composer-form');
    const lineHeightValue = lineHeight || 25.5;

    const setModeClass = (mode: 'single' | 'multi') => {
      if (!form) return;
      if (mode === 'multi') {
        form.classList.add('is-multiline');
        form.classList.remove('is-singleline');
      } else {
        form.classList.add('is-singleline');
        form.classList.remove('is-multiline');
      }
      // Forcer un reflow pour que le CSS soit appliqué avant la mesure
      void form.offsetHeight;
    };

    const measureHeight = (mode: 'single' | 'multi') => {
      setModeClass(mode);
      textarea.style.height = 'auto';
      return textarea.scrollHeight;
    };

    // Toujours mesurer la longueur de référence en mode single-line pour décider
    // du passage/retour en multiline, puis prendre la mesure réelle du layout courant
    const singleLineContentHeight = measureHeight('single');
    const multilineContentHeight = measureHeight('multi');

    // Restaurer le layout actuel immédiatement après la mesure
    setModeClass(isMultiline ? 'multi' : 'single');

    // Déterminer si on doit être en mode multiline avec hystérésis
    const shouldBeMultiline = isMultiline
      ? singleLineContentHeight > baseHeight + 2 // Revenir en single-line seulement quand ça tient sur une ligne de référence
      : singleLineContentHeight > baseHeight + (lineHeightValue * 0.1); // Activer si déborde la largeur single-line

    // Ajuster la hauteur immédiatement en fonction du contenu effectif
    const nextHeight = Math.max(isMultiline ? multilineContentHeight : singleLineContentHeight, baseHeight);
    textarea.style.height = `${Math.min(nextHeight, 200)}px`;

    // Changer le mode si nécessaire
    if (shouldBeMultiline !== isMultiline) {
      // Annuler le timeout précédent s'il existe
      if (modeChangeTimeoutRef.current) {
        clearTimeout(modeChangeTimeoutRef.current);
        modeChangeTimeoutRef.current = null;
      }

      setIsMultiline(shouldBeMultiline);
    }
  }, [inputValue, isMultiline]);

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

  // Gérer l'ajout de fichiers
  const handleFileSelect = useCallback(async (files: FileList | null) => {
    if (!files || !composer?.attachments?.enabled) return;

    const config = composer.attachments;
    const newAttachments: Attachment[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];

      // Vérifier le nombre max
      if (config.maxCount && attachments.length + newAttachments.length >= config.maxCount) {
        break;
      }

      // Valider le fichier
      const validation = validateFile(file, config);
      if (!validation.valid) {
        console.error(`[ChatKit] File validation failed: ${validation.error}`);
        continue;
      }

      const id = generateAttachmentId();
      const preview = await createFilePreview(file);
      const type = file.type.startsWith('image/') ? 'image' : 'file';

      newAttachments.push({
        id,
        file,
        type,
        preview: preview || undefined,
        status: 'pending',
      });
    }

    setAttachments(prev => [...prev, ...newAttachments]);
  }, [attachments.length, composer?.attachments]);

  // Supprimer un attachment
  const removeAttachment = useCallback((id: string) => {
    setAttachments(prev => prev.filter(att => att.id !== id));
  }, []);

  // Soumettre le message
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const message = inputValue.trim();
    const hasContent = message || attachments.length > 0;

    if (!hasContent || control.isLoading) return;

    try {
      // Upload des attachments d'abord
      if (attachments.length > 0 && options.api.url) {
        for (const att of attachments) {
          setAttachments(prev => prev.map(a =>
            a.id === att.id ? { ...a, status: 'uploading' as const } : a
          ));

          try {
            await uploadAttachment({
              url: options.api.url,
              headers: options.api.headers,
              attachmentId: att.id,
              file: att.file,
            });

            setAttachments(prev => prev.map(a =>
              a.id === att.id ? { ...a, status: 'uploaded' as const } : a
            ));
          } catch (err) {
            setAttachments(prev => prev.map(a =>
              a.id === att.id ? { ...a, status: 'error' as const, error: String(err) } : a
            ));
          }
        }
      }

      // Construire le contenu du message
      const content = [];
      if (message) {
        content.push({ type: 'input_text' as const, text: message });
      }
      for (const att of attachments) {
        if (att.status === 'uploaded') {
          content.push({
            type: att.type as 'image' | 'file',
            [att.type]: att.id,
          });
        }
      }

      // Envoyer le message
      await sendMessageWithInference(content as any);

      // Réinitialiser le formulaire
      setInputValue('');
      setAttachments([]);
    } catch (error) {
      console.error('[ChatKit] Failed to send message:', error);
    }
  };

  const handlePromptClick = (prompt: string) => {
    sendMessageWithInference(prompt);
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
    setTimeout(() => setCopiedMessageId(null), 2000);
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
  }), [control]);

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
            console.log('[ChatKit Render] Rendering', items.length, 'items:', items);
            return items.map((item) => {
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

            return (
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
                      {item.content.map((content, idx) => (
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
                {item.type === 'task' && (
                  <div className="chatkit-message-content">
                    <TaskRenderer task={item.task} theme={theme?.colorScheme} />
                  </div>
                )}

                {/* Workflow */}
                {item.type === 'workflow' && (
                  <>
                    <div className="chatkit-message-content">
                      <WorkflowRenderer workflow={item.workflow} theme={theme?.colorScheme} />
                    </div>

                    {/* Afficher les images (partielles ou finales) après le workflow */}
                    {(() => {
                      const imageTask = item.workflow.tasks.find(
                        (task: any) => task.type === 'image'
                      );
                      console.log('[ChatKit] Checking for images in workflow:', item.id, 'imageTask:', imageTask);
                      if (imageTask && imageTask.images && imageTask.images.length > 0) {
                        const image = imageTask.images[0];
                        const isLoading = imageTask.status_indicator === 'loading';
                        console.log('[ChatKit] Image found:', {
                          id: image.id,
                          status: imageTask.status_indicator,
                          isLoading: isLoading,
                          hasPartials: image.partials && image.partials.length > 0,
                          partialsCount: image.partials ? image.partials.length : 0,
                          hasB64: !!image.b64_json,
                          hasUrl: !!image.image_url,
                          hasDataUrl: !!image.data_url
                        });

                        // Afficher le partial pendant le loading
                        if (isLoading && image.partials && image.partials.length > 0) {
                          const lastPartial = image.partials[image.partials.length - 1];
                          const src = lastPartial.startsWith('data:')
                            ? lastPartial
                            : `data:image/png;base64,${lastPartial}`;
                          console.log('[ChatKit] Showing partial preview, count:', image.partials.length);
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
                            console.log('[ChatKit] Showing final image');
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

                      console.log('[ChatKit] Checking for computer_use in workflow:', item.id, 'computerUseTask:', computerUseTask);
                      if (computerUseTask) {
                        const hasScreenshots = computerUseTask.screenshots && computerUseTask.screenshots.length > 0;
                        const screenshot = hasScreenshots ? computerUseTask.screenshots[computerUseTask.screenshots.length - 1] : null;
                        // Check if THIS SPECIFIC task is loading (not the workflow)
                        const isLoading = computerUseTask.status_indicator === 'loading';

                        // Debug: log all relevant info
                        console.log('[ChatKit] Computer use task details:', {
                          hasDebugToken: !!computerUseTask.debug_url_token,
                          debugToken: computerUseTask.debug_url_token ? `${computerUseTask.debug_url_token.substring(0, 8)}...` : 'none',
                          debugUrl: computerUseTask.debug_url,
                          status: computerUseTask.status_indicator,
                          isLoading: isLoading,
                          screenshotsCount: computerUseTask.screenshots ? computerUseTask.screenshots.length : 0,
                          currentAction: computerUseTask.current_action,
                        });

                        if (hasScreenshots) {
                          console.log('[ChatKit] Screenshot info:', {
                            id: screenshot.id,
                            hasB64: !!screenshot.b64_image,
                            hasDataUrl: !!screenshot.data_url,
                            action: screenshot.action_description
                          });
                        }

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
                          console.log('[ChatKit] Using saved screenshot for item:', item.id);
                          src = lastScreencastScreenshot.src;
                        } else if (!src && lastScreencastScreenshot) {
                          console.log('[ChatKit] Have saved screenshot but item IDs do not match:', {
                            savedItemId: lastScreencastScreenshot.itemId,
                            currentItemId: item.id,
                          });
                        }

                        // Afficher la screenshot si on a une screenshot ET qu'on n'affiche pas le screencast live
                        // MAIS seulement si la tâche n'est pas complete (sinon on cache tout pour retourner au début)
                        const isComplete = computerUseTask.status_indicator === 'complete';
                        const showScreenshot = !!src && !showLiveScreencast && !isComplete;

                        const showPreview = showLiveScreencast || showScreenshot;

                        console.log('[ChatKit] Display decision:', {
                          showLiveScreencast,
                          showScreenshot,
                          showPreview,
                          isActiveScreencast,
                          hasDebugToken: !!computerUseTask.debug_url_token,
                          isLoading,
                          hasScreenshot: !!src,
                          screenshotCount: computerUseTask.screenshots?.length || 0,
                          screenshotIndex: screenshot ? computerUseTask.screenshots?.indexOf(screenshot) : -1,
                          screenshotId: screenshot?.id
                        });

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
                          const handleEndSession = async () => {
                            console.log('Ending computer_use session...');
                            try {
                              // Send an empty message to trigger workflow resumption
                              // The backend will detect the wait state and continue the workflow
                              await sendMessageWithInference('');
                            } catch (error) {
                              console.error('Failed to end computer_use session:', error);
                            }
                          };

                          return (
                            <div className="chatkit-computer-use-preview">
                              {actionTitle && (
                                <div className="chatkit-computer-action-title">{actionTitle}</div>
                              )}
                              {/* Show screencast if this is the active screencast */}
                              {showLiveScreencast && (
                                <>
                                  <DevToolsScreencast
                                    debugUrlToken={debugUrlToken as string}
                                    authToken={authToken}
                                    enableInput
                                    onConnectionError={() => {
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
                              {showScreenshot && (
                                <div className="chatkit-browser-screenshot-container">
                                  <div className="chatkit-browser-screenshot-image-wrapper">
                                    <ImageWithBlobUrl
                                      src={src}
                                      alt={actionTitle || "Browser automation"}
                                      className={isLoading ? "chatkit-browser-screenshot chatkit-browser-screenshot--loading" : "chatkit-browser-screenshot"}
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
            );
            });
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

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="chatkit-attachments-preview">
          {attachments.map(att => (
            <div key={att.id} className={`chatkit-attachment chatkit-attachment-${att.status}`}>
              {att.preview && <ImageWithBlobUrl src={att.preview} alt={att.file.name} />}
              {!att.preview && (
                <div className="chatkit-attachment-icon">
                  <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                  </svg>
                </div>
              )}
              <div className="chatkit-attachment-name">{att.file.name}</div>
              <button
                className="chatkit-attachment-remove"
                onClick={() => removeAttachment(att.id)}
                aria-label="Remove"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Composer */}
      <div className="chatkit-composer">
        <form
          onSubmit={handleSubmit}
          className={`chatkit-composer-form ${isMultiline ? 'is-multiline' : 'is-singleline'}`}
        >
          <div className="chatkit-input-area">
            <textarea
              ref={textareaRef}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                // Envoyer avec Entrée (sans Shift)
                if (e.key === 'Enter' && !e.shiftKey) {
                  if (control.isLoading || isThreadDisabled) {
                    return;
                  }
                  e.preventDefault();
                  handleSubmit(e);
                }
              }}
              placeholder={isThreadDisabled ? threadStatusMessage || '' : (composer?.placeholder || 'Posez votre question...')}
              className="chatkit-input"
              rows={1}
              disabled={isThreadDisabled}
            />
          </div>
          <div className="chatkit-composer-actions">
            {isModelSelectorEnabled && availableModels.length > 0 && (
              <div className="chatkit-model-selector">
                <label htmlFor="chatkit-model-select">Modèle</label>
                <select
                  id="chatkit-model-select"
                  value={selectedModelId ?? ''}
                  onChange={(e) => setSelectedModelId(e.target.value || null)}
                  disabled={isThreadDisabled}
                  aria-label="Sélectionner un modèle"
                >
                  {availableModels.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </select>
                {selectedModel?.description && (
                  <div className="chatkit-model-description">{selectedModel.description}</div>
                )}
              </div>
            )}
            {(composer?.attachments?.enabled || composer?.attachments !== false) && (
              <div className="chatkit-attach-wrapper">
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={composer?.attachments?.accept ? Object.values(composer.attachments.accept).flat().join(',') : undefined}
                  onChange={(e) => handleFileSelect(e.target.files)}
                  style={{ display: 'none' }}
                />
                <button
                  type="button"
                  className="chatkit-attach-button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={control.isLoading || !composer?.attachments?.enabled || isThreadDisabled}
                  aria-label="Joindre un fichier"
                  title="Joindre un fichier"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                  </svg>
                </button>
              </div>
            )}
            <button
              type="submit"
              disabled={(!inputValue.trim() && attachments.length === 0) || control.isLoading || isThreadDisabled}
              className="chatkit-submit"
              aria-label="Envoyer"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="16 12 12 8 8 12"></polyline>
                <line x1="12" y1="16" x2="12" y2="8"></line>
              </svg>
            </button>
          </div>
        </form>

        {/* Disclaimer */}
        {disclaimer && (
          <div className="chatkit-disclaimer">{disclaimer.text}</div>
        )}
      </div>

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
