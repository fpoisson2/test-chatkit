/**
 * Composant ChatKit complet avec toutes les fonctionnalités
 */
import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { ChatKitControl, ChatKitOptions, StartScreenPrompt } from '../types';
import { WidgetRenderer } from '../widgets';
import { WorkflowRenderer } from './WorkflowRenderer';
import { TaskRenderer } from './TaskRenderer';
import { AnnotationRenderer } from './AnnotationRenderer';
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
  const [inputValue, setInputValue] = useState('');
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [showHistory, setShowHistory] = useState(false);
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

  // Afficher le start screen si pas de messages
  const showStartScreen = !control.thread || control.thread.items.length === 0;

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
              {header.leftAction.icon === 'menu' ? '☰' : header.leftAction.icon}
            </button>
          )}
          <div className="chatkit-header-title">Chat</div>
          {history?.enabled !== false && (
            <button
              className="chatkit-header-action"
              onClick={() => setShowHistory(!showHistory)}
              aria-label="History"
            >
              📜
            </button>
          )}
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
                        {content.type === 'input_text' && <p>{content.text}</p>}
                        {content.type === 'input_tag' && (
                          <span className="chatkit-tag">{content.text}</span>
                        )}
                        {content.type === 'image' && <img src={content.image} alt="" />}
                        {content.type === 'file' && (
                          <div className="chatkit-file">📄 {content.file}</div>
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
                  <div className="chatkit-message-content">
                    {item.content.map((content, idx) => (
                      <div key={idx}>
                        {content.type === 'output_text' && (
                          <>
                            <p>{content.text}</p>
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
                )}

                {/* Client tool call */}
                {item.type === 'client_tool_call' && (
                  <div className="chatkit-message-content chatkit-tool-call">
                    🔧 {item.name}
                    {item.status === 'pending' && ' (en cours...)'}
                    {item.status === 'completed' && ' ✓'}
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
                    <TaskRenderer task={item.task} />
                  </div>
                )}

                {/* Workflow */}
                {item.type === 'workflow' && (
                  <div className="chatkit-message-content">
                    <WorkflowRenderer workflow={item.workflow} />
                  </div>
                )}
              </div>
            );
            });
          })()
        )}
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
              {!att.preview && <div className="chatkit-attachment-icon">📎</div>}
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
                aria-label="Attach file"
              >
                📎
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
          >
            {control.isLoading ? 'Envoi...' : 'Envoyer'}
          </button>
        </form>
      </div>
    </div>
  );
}
