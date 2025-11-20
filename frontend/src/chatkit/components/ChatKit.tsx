/**
 * Composant ChatKit complet avec toutes les fonctionnalités
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatKitControl, ChatKitOptions, StartScreenPrompt } from '../types';
import { WidgetRenderer } from '../widgets';
import { WorkflowRenderer } from './WorkflowRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AnnotationRenderer } from './AnnotationRenderer';
import { ThreadHistory } from './ThreadHistory';
import { MarkdownRenderer } from './MarkdownRenderer';
import { useI18n } from '../../i18n/I18nProvider';
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

export function ChatKit({ control, options, className, style }: ChatKitProps): JSX.Element {
  const { t } = useI18n();
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    header,
    history,
    startScreen,
    disclaimer,
    composer,
    theme,
  } = options;

  // Auto-scroll vers le bas
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [control.thread?.items.length]);

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
      await control.sendMessage(content as any);

      // Réinitialiser le formulaire
      setInputValue('');
      setAttachments([]);
    } catch (error) {
      console.error('[ChatKit] Failed to send message:', error);
    }
  };

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

  // Copier le contenu d'un message
  const handleCopyMessage = (messageId: string, content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedMessageId(messageId);
    setTimeout(() => setCopiedMessageId(null), 2000);
  };

  // Afficher le start screen si pas de messages
  const showStartScreen = !control.thread || control.thread.items.length === 0;

  // Récupérer le titre du thread
  const getThreadTitle = (): string => {
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
      style={style}
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
      <div className="chatkit-messages">
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
                        {content.type === 'image' && <img src={content.image} alt="" />}
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
                            <WidgetRenderer widget={content.widget} />
                          )}
                        </div>
                      ))}
                      {item.status === 'in_progress' && (
                        <div className="chatkit-loading-indicator">
                          <span className="chatkit-dot"></span>
                          <span className="chatkit-dot"></span>
                          <span className="chatkit-dot"></span>
                        </div>
                      )}
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
                    <WidgetRenderer widget={item.widget} />
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
                    {/* Afficher les partials d'images en cours de génération comme message */}
                    {(() => {
                      const imageTask = item.workflow.tasks.find(
                        (task: any) => task.type === 'image' && task.status_indicator === 'loading'
                      );
                      console.log('[ChatKit] Checking for image partials in workflow:', item.id, 'imageTask:', imageTask);
                      if (imageTask) {
                        console.log('[ChatKit] ImageTask found:', {
                          type: imageTask.type,
                          status: imageTask.status_indicator,
                          images: imageTask.images,
                          hasImages: imageTask.images && imageTask.images.length > 0
                        });
                        if (imageTask.images && imageTask.images.length > 0) {
                          const image = imageTask.images[0];
                          console.log('[ChatKit] Image data:', {
                            id: image.id,
                            hasPartials: image.partials && image.partials.length > 0,
                            partialsCount: image.partials ? image.partials.length : 0,
                            hasB64: !!image.b64_json,
                            hasUrl: !!image.image_url,
                            hasDataUrl: !!image.data_url
                          });
                          if (image.partials && image.partials.length > 0) {
                            const lastPartial = image.partials[image.partials.length - 1];
                            const src = lastPartial.startsWith('data:')
                              ? lastPartial
                              : `data:image/png;base64,${lastPartial}`;
                            console.log('[ChatKit] Showing partial preview, partials count:', image.partials.length);
                            return (
                              <div className="chatkit-image-generation-preview">
                                <img
                                  src={src}
                                  alt="Génération en cours..."
                                  className="chatkit-generating-image"
                                />
                              </div>
                            );
                          }
                        }
                      }
                      return null;
                    })()}

                    <div className="chatkit-message-content">
                      <WorkflowRenderer workflow={item.workflow} theme={theme?.colorScheme} />
                    </div>
                  </>
                )}
              </div>
            );
            });
          })()
        )}

        {/* Loading indicator */}
        {control.isLoading && (() => {
          const items = control.thread?.items || [];
          const hasAssistantContent = items.some(item =>
            item.type === 'assistant_message' ||
            item.type === 'workflow' ||
            item.type === 'widget'
          );
          return !hasAssistantContent && (
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

      {/* Disclaimer */}
      {disclaimer && (
        <div className="chatkit-disclaimer">{disclaimer.text}</div>
      )}

      {/* Attachments preview */}
      {attachments.length > 0 && (
        <div className="chatkit-attachments-preview">
          {attachments.map(att => (
            <div key={att.id} className={`chatkit-attachment chatkit-attachment-${att.status}`}>
              {att.preview && <img src={att.preview} alt={att.file.name} />}
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
        <form onSubmit={handleSubmit}>
          {composer?.attachments?.enabled && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                multiple
                accept={composer.attachments.accept ? Object.values(composer.attachments.accept).flat().join(',') : undefined}
                onChange={(e) => handleFileSelect(e.target.files)}
                style={{ display: 'none' }}
              />
              <button
                type="button"
                className="chatkit-attach-button"
                onClick={() => fileInputRef.current?.click()}
                disabled={control.isLoading}
                aria-label="Joindre un fichier"
                title="Joindre un fichier"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                </svg>
              </button>
            </>
          )}
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder={composer?.placeholder || 'Posez votre question...'}
            disabled={control.isLoading}
            className="chatkit-input"
          />
          <button
            type="submit"
            disabled={(!inputValue.trim() && attachments.length === 0) || control.isLoading}
            className="chatkit-submit"
            aria-label="Envoyer"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="16 12 12 8 8 12"></polyline>
              <line x1="12" y1="16" x2="12" y2="8"></line>
            </svg>
          </button>
        </form>
      </div>

      {/* Thread History Modal */}
      {showHistory && (
        <ThreadHistory
          api={options.api}
          currentThreadId={control.thread?.id || null}
          onThreadSelect={handleThreadSelect}
          onClose={() => setShowHistory(false)}
        />
      )}
    </div>
  );
}
