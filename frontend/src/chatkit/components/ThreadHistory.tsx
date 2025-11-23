/**
 * Composant pour afficher l'historique des threads
 */
import React, { useState, useEffect } from 'react';
import type { Thread, ChatKitAPIConfig } from '../types';
import { deleteThread, listThreads } from '../api/streaming';
import './ThreadHistory.css';

export interface ThreadHistoryProps {
  api: ChatKitAPIConfig;
  currentThreadId: string | null;
  loadingThreadIds?: Set<string>;
  onThreadSelect: (threadId: string) => void;
  onThreadDeleted?: (threadId: string) => void;
  onClose: () => void;
}

export function ThreadHistory({ api, currentThreadId, loadingThreadIds, onThreadSelect, onThreadDeleted, onClose }: ThreadHistoryProps): JSX.Element {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [after, setAfter] = useState<string | undefined>(undefined);

  const loadThreads = async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true);
      setAfter(undefined);
    } else {
      setIsLoadingMore(true);
    }
    setError(null);

    try {
      const response = await listThreads({
        url: api.url,
        headers: api.headers,
        limit: 10,
        order: 'desc',
        after: isInitial ? undefined : after,
      });

      const newThreads = response.data || [];
      setThreads(prev => isInitial ? newThreads : [...prev, ...newThreads]);
      setHasMore(newThreads.length === 10);

      if (newThreads.length > 0) {
        setAfter(newThreads[newThreads.length - 1].id);
      }
    } catch (err) {
      console.error('[ThreadHistory] Failed to load threads:', err);
      setError('Impossible de charger l\'historique');
      if (isInitial) {
        setThreads([]);
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  };

  useEffect(() => {
    loadThreads(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api.url, api.headers]);

  const handleThreadClick = (threadId: string) => {
    onThreadSelect(threadId);
    onClose();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>, threadId: string) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleThreadClick(threadId);
    }
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

  const normalizeItems = (thread: Thread) => Array.isArray(thread.items) ? thread.items : (thread.items as any)?.data || [];

  const getThreadTitle = (thread: Thread): string => {
    const metadataTitle = typeof thread.metadata?.title === 'string' ? thread.metadata.title : null;
    const candidateTitle = (thread.title || metadataTitle)?.trim();

    if (candidateTitle) {
      return candidateTitle;
    }

    const items = normalizeItems(thread);
    const userMessage = items.find((item: any) => item.type === 'user_message');
    if (userMessage && userMessage.type === 'user_message') {
      const textContent = userMessage.content.find((c: any) => c.type === 'input_text');
      if (textContent && textContent.type === 'input_text') {
        return textContent.text.substring(0, 60) + (textContent.text.length > 60 ? '...' : '');
      }
    }

    return 'Conversation sans titre';
  };

  const handleDeleteThread = async (threadId: string) => {
    const confirmDelete = window.confirm('Supprimer cette conversation ?');
    if (!confirmDelete) {
      return;
    }

    setDeleteError(null);
    setDeletingThreadId(threadId);

    try {
      await deleteThread({
        url: api.url,
        headers: api.headers,
        threadId,
      });

      setThreads((prev) => prev.filter((thread) => thread.id !== threadId));
      if (currentThreadId === threadId) {
        onThreadDeleted?.(threadId);
      }
    } catch (err) {
      console.error('[ThreadHistory] Failed to delete thread:', err);
      setDeleteError('Impossible de supprimer la conversation');
    } finally {
      setDeletingThreadId(null);
    }
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

          {deleteError && (
            <div className="thread-history-error">
              <p>{deleteError}</p>
            </div>
          )}

          {!isLoading && !error && threads.length === 0 && (
            <div className="thread-history-empty">
              <p>Aucune conversation trouvée</p>
            </div>
          )}

          {!isLoading && !error && threads.length > 0 && (
            <>
              <div className="thread-history-list">
                {threads.map((thread) => {
                  const items = normalizeItems(thread);
                  return (
                    <div
                      key={thread.id}
                      className={`thread-history-item ${thread.id === currentThreadId ? 'active' : ''}`}
                      role="button"
                      tabIndex={0}
                      onClick={() => handleThreadClick(thread.id)}
                      onKeyDown={(event) => handleKeyDown(event, thread.id)}
                    >
                      <div className="thread-history-item-info">
                        <div className="thread-history-item-preview">
                          {getThreadTitle(thread)}
                        </div>
                        <div className="thread-history-item-date">
                          {items.length > 0 && formatDate(items[0].created_at)}
                        </div>
                      </div>
                      {loadingThreadIds?.has(thread.id) && (
                        <div className="thread-history-item-spinner" />
                      )}
                      <button
                        className="thread-history-item-delete"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteThread(thread.id);
                        }}
                        aria-label="Supprimer cette conversation"
                        disabled={deletingThreadId === thread.id}
                      >
                        {deletingThreadId === thread.id ? '...' : '×'}
                      </button>
                    </div>
                  );
                })}
              </div>

              {hasMore && (
                <div className="thread-history-load-more">
                  <button
                    className="button button--subtle button--sm"
                    onClick={() => loadThreads(false)}
                    disabled={isLoadingMore}
                  >
                    {isLoadingMore ? 'Chargement...' : 'Charger plus'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
