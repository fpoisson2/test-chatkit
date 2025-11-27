/**
 * ConversationsSidebarSection - Section displaying all conversations in the sidebar
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type MutableRefObject } from "react";
import type { Thread, ChatKitAPIConfig } from "../../chatkit/types";
import { listThreads, deleteThread, updateThreadTitle } from "../../chatkit/api/streaming/api";
import {
  type ActionMenuPlacement,
  computeWorkflowActionMenuPlacement,
  getActionMenuStyle,
  getActionMenuItemStyle,
} from "./WorkflowActionMenu";
import { TruncatedText } from "../../components/TruncatedText";
import { AnimatedTitle } from "../../components/AnimatedTitle";
import "./ConversationsSidebarSection.css";

export interface ThreadWorkflowMetadata {
  id?: number;
  slug?: string;
  definition_id?: string;
  display_name?: string;
}

export interface ConversationsSidebarSectionProps {
  api: ChatKitAPIConfig | null;
  currentThreadId: string | null;
  /** Latest snapshot of the active thread to keep the list in sync */
  activeThreadSnapshot?: Thread | null;
  streamingThreadIds?: Set<string>;
  onThreadSelect: (threadId: string, workflowMetadata?: ThreadWorkflowMetadata) => void;
  onThreadDeleted?: (threadId: string) => void;
  onNewConversation?: () => void;
  searchQuery?: string;
  maxVisible?: number;
  title?: string;
  emptyMessage?: string;
  isCollapsed?: boolean;
  isMobileLayout?: boolean;
  /** When true, shows a "New conversation" draft entry at the top of the list */
  isNewConversationActive?: boolean;
  /** When true, shows a streaming spinner on the "New conversation" entry */
  isNewConversationStreaming?: boolean;
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
  streamingThreadIds,
  onThreadSelect,
  onThreadDeleted,
  onNewConversation,
  searchQuery = "",
  maxVisible = 10,
  title = "Conversations",
  emptyMessage = "Aucune conversation",
  isCollapsed = false,
  isMobileLayout = false,
  isNewConversationActive = false,
  isNewConversationStreaming = false,
  activeThreadSnapshot,
}: ConversationsSidebarSectionProps): JSX.Element | null {
  const [threads, setThreads] = useState<Thread[]>(cachedThreads);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(cachedHasMore);
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<ActionMenuPlacement>("down");
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

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
        allWorkflows: true,
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

  // Keep sidebar entry in sync with the latest active thread snapshot (title, metadata...)
  useEffect(() => {
    if (!activeThreadSnapshot?.id) {
      return;
    }

    setThreads((currentThreads) => {
      const targetIndex = currentThreads.findIndex((thread) => thread.id === activeThreadSnapshot.id);
      if (targetIndex === -1) {
        return currentThreads;
      }

      const existing = currentThreads[targetIndex];
      const updated = { ...existing, ...activeThreadSnapshot, metadata: { ...existing.metadata, ...activeThreadSnapshot.metadata } };

      const nextThreads = [...currentThreads];
      nextThreads[targetIndex] = updated;
      cachedThreads = nextThreads;
      return nextThreads;
    });
  }, [activeThreadSnapshot]);

  // Auto-refresh when currentThreadId changes to a thread not in the list
  // This handles the case when a new conversation is created via ChatKit
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!api || !currentThreadId) {
      prevThreadIdRef.current = currentThreadId;
      return;
    }

    // Only trigger refresh if the thread ID actually changed
    if (prevThreadIdRef.current === currentThreadId) {
      return;
    }

    prevThreadIdRef.current = currentThreadId;

    // Check if this thread exists in our cached list
    const threadExists = threads.some((thread) => thread.id === currentThreadId);

    // If the thread doesn't exist in our list, refresh to fetch it
    if (!threadExists) {
      console.debug("[ConversationsSidebarSection] New thread detected, refreshing list:", currentThreadId);
      loadThreads(true, true);
    }
  }, [api, currentThreadId, threads, loadThreads]);

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

  const handleRenameThread = useCallback(async (threadId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!api) return;

    const newTitle = window.prompt("Nouveau nom de la conversation :", currentTitle);
    if (newTitle === null || newTitle.trim() === "" || newTitle.trim() === currentTitle) return;

    const trimmedTitle = newTitle.trim();

    try {
      await updateThreadTitle({
        url: api.url,
        headers: api.headers,
        threadId,
        title: trimmedTitle,
      });

      // Update local state - update thread.title directly
      const updatedThreads = threads.map((thread) => {
        if (thread.id === threadId) {
          return {
            ...thread,
            title: trimmedTitle,
          };
        }
        return thread;
      });
      setThreads(updatedThreads);
      cachedThreads = updatedThreads;
    } catch (err) {
      console.error("[ConversationsSidebarSection] Failed to rename thread:", err);
      alert("Impossible de renommer la conversation.");
    }
  }, [api, threads]);

  // Close menu when clicking outside
  useEffect(() => {
    if (!openMenuId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        menuRef.current &&
        !menuRef.current.contains(target) &&
        menuTriggerRef.current &&
        !menuTriggerRef.current.contains(target)
      ) {
        setOpenMenuId(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openMenuId]);

  const handleMenuOpen = useCallback((threadId: string, placement: ActionMenuPlacement) => {
    setMenuPlacement(placement);
    setOpenMenuId(threadId);
  }, []);

  const handleMenuClose = useCallback(() => {
    setOpenMenuId(null);
  }, []);

  const handleMenuTriggerClick = useCallback(
    (threadId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      const trigger = event.currentTarget;
      menuTriggerRef.current = trigger;

      if (openMenuId === threadId) {
        setOpenMenuId(null);
        return;
      }

      const nextPlacement = isMobileLayout
        ? computeWorkflowActionMenuPlacement(trigger)
        : "down";
      handleMenuOpen(threadId, nextPlacement);
    },
    [openMenuId, isMobileLayout, handleMenuOpen]
  );

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

  const sectionVariant = isMobileLayout ? "overlay" : "default";

  return (
    <section
      className="conversations-sidebar-section"
      aria-labelledby="conversations-section-title"
      data-variant={sectionVariant === "overlay" ? "overlay" : undefined}
    >
      <div className="chatkit-sidebar__section-header">
        <h2 id="conversations-section-title" className="chatkit-sidebar__section-title">
          {title}
        </h2>
        {onNewConversation && (
          <div className="chatkit-sidebar__section-floating-action">
            <button
              type="button"
              className="chatkit-sidebar__section-icon-button"
              onClick={onNewConversation}
              aria-label="Nouvelle conversation"
              title="Nouvelle conversation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </button>
          </div>
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
      ) : displayedThreads.length === 0 && !isNewConversationActive ? (
        <p className="conversations-sidebar-section__empty">{emptyMessage}</p>
      ) : (
        <>
          <ul className="conversations-sidebar-section__list">
            {/* Show draft "New conversation" entry when active */}
            {isNewConversationActive && !searchQuery.trim() && (
              <li className="conversations-sidebar-section__item">
                <button
                  type="button"
                  className="conversations-sidebar-section__thread-button conversations-sidebar-section__thread-button--active"
                  aria-current="true"
                >
                  <span className="conversations-sidebar-section__thread-title-row">
                    {isNewConversationStreaming && (
                      <span className="conversations-sidebar-section__thread-spinner" aria-label="En cours" />
                    )}
                    <TruncatedText className="conversations-sidebar-section__thread-title">Nouvelle conversation</TruncatedText>
                  </span>
                </button>
              </li>
            )}
            {displayedThreads.map((thread) => {
              const items = normalizeItems(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const isStreaming = streamingThreadIds?.has(thread.id) ?? false;
              const threadTitle = getThreadTitle(thread);
              const dateStr = items.length > 0 ? formatRelativeDate(items[0].created_at) : "";
              const isMenuOpen = openMenuId === thread.id;
              const menuId = `conversation-menu-${thread.id}`;

              // Extract workflow metadata from thread
              const workflowMetadata = thread.metadata?.workflow as ThreadWorkflowMetadata | undefined;

              return (
                <li
                  key={thread.id}
                  className="conversations-sidebar-section__item"
                  data-has-actions=""
                >
                  <button
                    type="button"
                    className={`conversations-sidebar-section__thread-button${isActive ? " conversations-sidebar-section__thread-button--active" : ""}`}
                    onClick={() => onThreadSelect(thread.id, workflowMetadata)}
                    disabled={isDeleting}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="conversations-sidebar-section__thread-title-row">
                      {isStreaming && (
                        <span className="conversations-sidebar-section__thread-spinner" aria-label="En cours" />
                      )}
                      <TruncatedText className="conversations-sidebar-section__thread-title">
                        <AnimatedTitle stableId={thread.id} disabled={isStreaming}>{threadTitle}</AnimatedTitle>
                      </TruncatedText>
                    </span>
                  </button>
                  <div className="conversations-sidebar-section__actions" data-conversation-menu-container="">
                    <button
                      type="button"
                      className="conversations-sidebar-section__action-button"
                      data-conversation-menu-trigger=""
                      aria-haspopup="true"
                      aria-expanded={isMenuOpen}
                      aria-controls={menuId}
                      disabled={isDeleting}
                      onClick={(e) => handleMenuTriggerClick(thread.id, e)}
                    >
                      <span aria-hidden="true">…</span>
                      <span className="visually-hidden">Actions pour {threadTitle}</span>
                    </button>
                    {isMenuOpen && (
                      <div
                        id={menuId}
                        role="menu"
                        data-conversation-menu=""
                        className="conversations-sidebar-section__menu"
                        style={getActionMenuStyle(isMobileLayout, menuPlacement)}
                        ref={menuRef}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMenuClose();
                            handleRenameThread(thread.id, threadTitle, e);
                          }}
                          disabled={isDeleting}
                          style={getActionMenuItemStyle(isMobileLayout)}
                        >
                          Renommer
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleMenuClose();
                            handleDeleteThread(thread.id, e);
                          }}
                          disabled={isDeleting}
                          style={{
                            ...getActionMenuItemStyle(isMobileLayout, { danger: true }),
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    )}
                  </div>
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
