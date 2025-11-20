/**
 * Composant principal ChatKit
 */
import React, { useState, useRef, useEffect } from 'react';
import type { ChatKitControl, ChatKitOptions } from '../types';
import { WidgetRenderer } from '../widgets';
import './ChatKit.css';

export interface ChatKitProps {
  control: ChatKitControl;
  className?: string;
  style?: React.CSSProperties;
}

export function ChatKit({ control, className, style }: ChatKitProps): JSX.Element {
  const [inputValue, setInputValue] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll vers le bas quand de nouveaux messages arrivent
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [control.thread?.items.length]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!inputValue.trim() || control.isLoading) {
      return;
    }

    const message = inputValue.trim();
    setInputValue('');

    try {
      await control.sendMessage(message);
    } catch (error) {
      console.error('[ChatKit] Failed to send message:', error);
    }
  };

  return (
    <div className={`chatkit ${className || ''}`} style={style}>
      {/* Messages */}
      <div className="chatkit-messages">
        {!control.thread || control.thread.items.length === 0 ? (
          <div className="chatkit-empty-state">
            <p>Commencez une conversation</p>
          </div>
        ) : (
          control.thread.items.map((item) => (
            <div
              key={item.id}
              className={`chatkit-message chatkit-message-${item.type === 'user_message' ? 'user' : 'assistant'}`}
            >
              {item.type === 'user_message' ? (
                <div className="chatkit-message-content">
                  {item.content.map((content, idx) => (
                    <div key={idx}>
                      {content.type === 'text' && <p>{content.text}</p>}
                      {content.type === 'image' && <img src={content.image} alt="" />}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="chatkit-message-content">
                  {item.content.map((content, idx) => (
                    <div key={idx}>
                      {content.type === 'text' && <p>{content.text}</p>}
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
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error display */}
      {control.error && (
        <div className="chatkit-error">
          <strong>Erreur:</strong> {control.error.message}
        </div>
      )}

      {/* Composer */}
      <div className="chatkit-composer">
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Posez votre question..."
            disabled={control.isLoading}
            className="chatkit-input"
          />
          <button
            type="submit"
            disabled={!inputValue.trim() || control.isLoading}
            className="chatkit-submit"
          >
            {control.isLoading ? 'Envoi...' : 'Envoyer'}
          </button>
        </form>
      </div>
    </div>
  );
}
