/**
 * ConversationsSidebarSection - Section displaying all conversations in the sidebar
 */
import { useState, useEffect, useCallback, useMemo, type ReactNode } from "react";
import type { Thread, ChatKitAPIConfig } from "../../chatkit/types";
import { listThreads, deleteThread } from "../../chatkit/api/streaming/api";
import "./ConversationsSidebarSection.css";

export interface ConversationsSidebarSectionProps {
  api: ChatKitAPIConfig | null;
  currentThreadId: string | null;
  onThreadSelect: (threadId: string) => void;
  onThreadDeleted?: (threadId: string) => void;
  onNewConversation?: () => void;
  searchQuery?: string;
  maxVisible?: number;
  title?: string;
  emptyMessage?: string;
  isCollapsed?: boolean;
}

// Cache at module level to persist data between mounts
let cachedThreads: Thread[] = [];
let cachedHasMore = true;

const normalizeItems = (thread: Thread) =>
  Array.isArray(thread.items) ? thread.items : (thread.items as any)?.data || [];

const getThreadTitle = (thread: Thread): string => {
  const metadataTitle = typeof thread.metadata?.title === "string" ? thread.metadata.title : null;
  const candidateTitle = (thread.title || metadataTitle)?.trim();

  if (candidateTitle) {
    return candidateTitle;
  }

  const items = normalizeItems(thread);
  const userMessage = items.find((item: any) => item.type === "user_message");
  if (userMessage && userMessage.type === "user_message") {
    const textContent = userMessage.content.find((c: any) => c.type === "input_text");
    if (textContent && textContent.type === "input_text") {
      return textContent.text.substring(0, 50) + (textContent.text.length > 50 ? "…" : "");
    }
  }

  return "Conversation sans titre";
};

const formatRelativeDate = (dateString: string): string => {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (days === 0) {
    return "Aujourd'hui";
  } else if (days === 1) {
    return "Hier";
  } else if (days < 7) {
    return `Il y a ${days} jours`;
  } else {
    return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  }
};

export function ConversationsSidebarSection({
  api,
  currentThreadId,
  onThreadSelect,
  onThreadDeleted,
  onNewConversation,
  searchQuery = "",
  maxVisible = 10,
  title = "Conversations",
  emptyMessage = "Aucune conversation",
  isCollapsed = false,
}: ConversationsSidebarSectionProps): JSX.Element | null {
  const [threads, setThreads] = useState<Thread[]>(cachedThreads);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(cachedHasMore);
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const loadThreads = useCallback(async (isInitial = false, isRefresh = false) => {
    if (!api) return;

    if (isInitial && !isRefresh && cachedThreads.length === 0) {
      setIsLoading(true);
    } else if (!isInitial) {
      setIsLoadingMore(true);
    }
    setError(null);

    // Reset pagination cursor when doing initial load or refresh
    const cursorToUse = (isInitial || isRefresh) ? undefined : after;

    try {
      const response = await listThreads({
        url: api.url,
        headers: api.headers,
        limit: 20,
        order: "desc",
        after: cursorToUse,
      });

      const newThreads = response.data || [];
      const updatedHasMore = newThreads.length === 20;

      // For initial load or refresh, replace all threads; otherwise append
      setThreads((currentThreads) => {
        const updatedThreads = (isInitial || isRefresh) ? newThreads : [...currentThreads, ...newThreads];
        cachedThreads = updatedThreads;
        return updatedThreads;
      });

      setHasMore(updatedHasMore);
      cachedHasMore = updatedHasMore;

      // Update pagination cursor - reset for initial/refresh, update for load more
      if (isInitial || isRefresh) {
        const newAfter = newThreads.length > 0 ? newThreads[newThreads.length - 1].id : undefined;
        setAfter(newAfter);
      } else {
        setAfter((currentAfter) =>
          newThreads.length > 0 ? newThreads[newThreads.length - 1].id : currentAfter
        );
      }
    } catch (err) {
      console.error("[ConversationsSidebarSection] Failed to load threads:", err);
      setError("Impossible de charger les conversations");
      if (isInitial && !isRefresh && cachedThreads.length === 0) {
        setThreads([]);
        cachedThreads = [];
      }
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [api, after]);

  useEffect(() => {
    if (api) {
      loadThreads(true, cachedThreads.length > 0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api?.url]);

  const handleDeleteThread = useCallback(async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!api) return;

    const confirmDelete = window.confirm("Supprimer cette conversation ?");
    if (!confirmDelete) return;

    setDeletingThreadId(threadId);

    try {
      await deleteThread({
        url: api.url,
        headers: api.headers,
        threadId,
      });

      const updatedThreads = threads.filter((thread) => thread.id !== threadId);
      setThreads(updatedThreads);
      cachedThreads = updatedThreads;

      if (currentThreadId === threadId) {
        onThreadDeleted?.(threadId);
      }
    } catch (err) {
      console.error("[ConversationsSidebarSection] Failed to delete thread:", err);
    } finally {
      setDeletingThreadId(null);
    }
  }, [api, threads, currentThreadId, onThreadDeleted]);

  // Filter threads by search query
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) {
      return threads;
    }
    const query = searchQuery.toLowerCase().trim();
    return threads.filter((thread) => {
      const title = getThreadTitle(thread).toLowerCase();
      return title.includes(query);
    });
  }, [threads, searchQuery]);

  // Determine which threads to display
  const displayedThreads = useMemo(() => {
    if (isExpanded || searchQuery.trim()) {
      return filteredThreads;
    }
    return filteredThreads.slice(0, maxVisible);
  }, [filteredThreads, isExpanded, maxVisible, searchQuery]);

  const hasHiddenThreads = filteredThreads.length > maxVisible && !isExpanded && !searchQuery.trim();

  if (isCollapsed) {
    return null;
  }

  if (!api) {
    return null;
  }

  return (
    <section className="conversations-sidebar-section" aria-labelledby="conversations-section-title">
      <div className="conversations-sidebar-section__header">
        <h3 id="conversations-section-title" className="conversations-sidebar-section__title">
          {title}
        </h3>
        {onNewConversation && (
          <button
            type="button"
            className="conversations-sidebar-section__new-button"
            onClick={onNewConversation}
            aria-label="Nouvelle conversation"
            title="Nouvelle conversation"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        )}
      </div>

      {isLoading && threads.length === 0 ? (
        <div className="conversations-sidebar-section__loading">
          <div className="conversations-sidebar-section__spinner" />
        </div>
      ) : error ? (
        <div className="conversations-sidebar-section__error">
          <p>{error}</p>
          <button
            type="button"
            className="conversations-sidebar-section__retry"
            onClick={() => loadThreads(true, true)}
          >
            Réessayer
          </button>
        </div>
      ) : displayedThreads.length === 0 ? (
        <p className="conversations-sidebar-section__empty">{emptyMessage}</p>
      ) : (
        <>
          <ul className="conversations-sidebar-section__list">
            {displayedThreads.map((thread) => {
              const items = normalizeItems(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const threadTitle = getThreadTitle(thread);
              const dateStr = items.length > 0 ? formatRelativeDate(items[0].created_at) : "";

              return (
                <li key={thread.id} className="conversations-sidebar-section__item">
                  <button
                    type="button"
                    className={`conversations-sidebar-section__thread-button${isActive ? " conversations-sidebar-section__thread-button--active" : ""}`}
                    onClick={() => onThreadSelect(thread.id)}
                    disabled={isDeleting}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="conversations-sidebar-section__thread-title">{threadTitle}</span>
                    {dateStr && (
                      <span className="conversations-sidebar-section__thread-date">{dateStr}</span>
                    )}
                  </button>
                  <button
                    type="button"
                    className="conversations-sidebar-section__delete-button"
                    onClick={(e) => handleDeleteThread(thread.id, e)}
                    disabled={isDeleting}
                    aria-label="Supprimer cette conversation"
                    title="Supprimer"
                  >
                    {isDeleting ? "…" : "×"}
                  </button>
                </li>
              );
            })}
          </ul>

          {hasHiddenThreads && (
            <button
              type="button"
              className="conversations-sidebar-section__show-more"
              onClick={() => setIsExpanded(true)}
            >
              Afficher tout ({filteredThreads.length})
            </button>
          )}

          {isExpanded && hasMore && !searchQuery.trim() && (
            <button
              type="button"
              className="conversations-sidebar-section__load-more"
              onClick={() => loadThreads(false)}
              disabled={isLoadingMore}
            >
              {isLoadingMore ? "Chargement…" : "Charger plus"}
            </button>
          )}

          {isExpanded && !hasHiddenThreads && (
            <button
              type="button"
              className="conversations-sidebar-section__show-less"
              onClick={() => setIsExpanded(false)}
            >
              Réduire
            </button>
          )}
        </>
      )}
    </section>
  );
}

export default ConversationsSidebarSection;
