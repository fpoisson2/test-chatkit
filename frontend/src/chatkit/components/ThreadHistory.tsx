/**
 * Composant pour afficher l'historique des threads
 */
import React, { useState, useEffect } from 'react';
import type { Thread, ChatKitAPIConfig } from '../types';
import { listThreads } from '../api/streaming';
import './ThreadHistory.css';

export interface ThreadHistoryProps {
  api: ChatKitAPIConfig;
  currentThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
  onClose: () => void;
}

export function ThreadHistory({ api, currentThreadId, onThreadSelect, onClose }: ThreadHistoryProps): JSX.Element {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadThreads = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const response = await listThreads({
          url: api.url,
          headers: api.headers,
          limit: 20,
          order: 'desc',
        });

        setThreads(response.data || []);
      } catch (err) {
        console.error('[ThreadHistory] Failed to load threads:', err);
        setError('Impossible de charger l\'historique');
        setThreads([]);
      } finally {
        setIsLoading(false);
      }
    };

    loadThreads();
  }, [api.url, api.headers]);

  const handleThreadClick = (threadId: string) => {
    onThreadSelect(threadId);
    onClose();
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return "Aujourd'hui";
    } else if (days === 1) {
      return 'Hier';
    } else if (days < 7) {
      return `Il y a ${days} jours`;
    } else {
      return date.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
    }
  };

  const getThreadPreview = (thread: Thread): string => {
    // Trouver le premier message utilisateur
    const userMessage = thread.items.find(item => item.type === 'user_message');
    if (userMessage && userMessage.type === 'user_message') {
      const textContent = userMessage.content.find(c => c.type === 'input_text');
      if (textContent && textContent.type === 'input_text') {
        return textContent.text.substring(0, 60) + (textContent.text.length > 60 ? '...' : '');
      }
    }
    return 'Conversation sans titre';
  };

  return (
    <div className="thread-history-overlay" onClick={onClose}>
      <div className="thread-history-panel" onClick={(e) => e.stopPropagation()}>
        <div className="thread-history-header">
          <h2>Historique des conversations</h2>
          <button className="thread-history-close" onClick={onClose} aria-label="Fermer">
            ×
          </button>
        </div>

        <div className="thread-history-content">
          {isLoading && (
            <div className="thread-history-loading">
              <div className="thread-history-spinner"></div>
              <p>Chargement...</p>
            </div>
          )}

          {error && (
            <div className="thread-history-error">
              <p>{error}</p>
            </div>
          )}

          {!isLoading && !error && threads.length === 0 && (
            <div className="thread-history-empty">
              <p>Aucune conversation trouvée</p>
            </div>
          )}

          {!isLoading && !error && threads.length > 0 && (
            <div className="thread-history-list">
              {threads.map((thread) => (
                <button
                  key={thread.id}
                  className={`thread-history-item ${thread.id === currentThreadId ? 'active' : ''}`}
                  onClick={() => handleThreadClick(thread.id)}
                >
                  <div className="thread-history-item-preview">
                    {getThreadPreview(thread)}
                  </div>
                  <div className="thread-history-item-date">
                    {thread.items.length > 0 && formatDate(thread.items[0].created_at)}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
