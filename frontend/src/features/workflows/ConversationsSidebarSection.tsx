/**
 * ConversationsSidebarSection - Section displaying all conversations in the sidebar
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode, type MutableRefObject } from "react";
import type { Thread, ChatKitAPIConfig } from "../../chatkit/types";
import { deleteThread, updateThreadTitle } from "../../chatkit/api/streaming/api";
import {
  type ActionMenuPlacement,
  computeWorkflowActionMenuPlacement,
  getActionMenuStyle,
  getActionMenuItemStyle,
} from "./WorkflowActionMenu";
import { TruncatedText } from "../../components/TruncatedText";
import { AnimatedTitle } from "../../components/AnimatedTitle";
import { useThreads } from "../../hooks/useThreads";
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
  /** When true, a new conversation is being drafted (used for empty state logic) */
  isNewConversationActive?: boolean;
}

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
  activeThreadSnapshot,
}: ConversationsSidebarSectionProps): JSX.Element | null {
  const {
    threads,
    isLoading,
    isFetchingNextPage: isLoadingMore,
    error,
    hasMore,
    fetchNextPage,
    refetch,
    updateThread,
    addThread,
    removeThread,
    reset: resetThreads,
  } = useThreads(api);

  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Track thread IDs that were created during this session (for title animation)
  const [newlyCreatedThreadIds, setNewlyCreatedThreadIds] = useState<Set<string>>(new Set());

  // Track if we just did a bulk delete (to ignore stale snapshots)
  // Use both state (for re-render) and ref (for synchronous checks in effects)
  const [postBulkDelete, setPostBulkDelete] = useState(false);
  const postBulkDeleteRef = useRef(false);

  // Track thread IDs that should show spinner (with delay to avoid flash)
  const [visibleSpinnerIds, setVisibleSpinnerIds] = useState<Set<string>>(new Set());
  const spinnerTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Manage delayed spinner visibility
  useEffect(() => {
    const currentStreaming = streamingThreadIds ?? new Set<string>();

    // Add timers for new streaming threads
    currentStreaming.forEach((threadId) => {
      if (!visibleSpinnerIds.has(threadId) && !spinnerTimersRef.current.has(threadId)) {
        const timer = setTimeout(() => {
          setVisibleSpinnerIds((prev) => new Set(prev).add(threadId));
          spinnerTimersRef.current.delete(threadId);
        }, 250);
        spinnerTimersRef.current.set(threadId, timer);
      }
    });

    // Remove spinners for threads that stopped streaming
    visibleSpinnerIds.forEach((threadId) => {
      if (!currentStreaming.has(threadId)) {
        setVisibleSpinnerIds((prev) => {
          const next = new Set(prev);
          next.delete(threadId);
          return next;
        });
      }
    });

    // Clear timers for threads that stopped streaming before delay
    spinnerTimersRef.current.forEach((timer, threadId) => {
      if (!currentStreaming.has(threadId)) {
        clearTimeout(timer);
        spinnerTimersRef.current.delete(threadId);
      }
    });

    return () => {
      // Cleanup all timers on unmount
      spinnerTimersRef.current.forEach((timer) => clearTimeout(timer));
    };
  }, [streamingThreadIds, visibleSpinnerIds]);

  // Keep track of the last streaming thread snapshot to show spinner even after clicking "+"
  const [lastStreamingSnapshot, setLastStreamingSnapshot] = useState<Thread | null>(null);

  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<ActionMenuPlacement>("down");
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Listen for bulk conversation deletion events (from admin cleanup)
  useEffect(() => {
    const handleBulkDelete = () => {
      resetThreads();
      setLastStreamingSnapshot(null);
      // Ignore stale snapshots from parent until a new conversation is created
      postBulkDeleteRef.current = true;
      setPostBulkDelete(true);
      onNewConversation?.();
    };

    window.addEventListener("conversations-deleted", handleBulkDelete);
    return () => window.removeEventListener("conversations-deleted", handleBulkDelete);
  }, [resetThreads, onNewConversation]);

  // Update lastStreamingSnapshot when activeThreadSnapshot is streaming
  useEffect(() => {
    if (activeThreadSnapshot?.id && streamingThreadIds?.has(activeThreadSnapshot.id)) {
      setLastStreamingSnapshot(activeThreadSnapshot);
    }
  }, [activeThreadSnapshot, streamingThreadIds]);

  // Clear lastStreamingSnapshot when streaming ends for that thread
  useEffect(() => {
    if (lastStreamingSnapshot?.id && !streamingThreadIds?.has(lastStreamingSnapshot.id)) {
      setLastStreamingSnapshot(null);
    }
  }, [lastStreamingSnapshot?.id, streamingThreadIds]);

  // Reset postBulkDelete when a new conversation starts streaming
  useEffect(() => {
    if (postBulkDelete && activeThreadSnapshot?.id && streamingThreadIds?.has(activeThreadSnapshot.id)) {
      postBulkDeleteRef.current = false;
      setPostBulkDelete(false);
    }
  }, [postBulkDelete, activeThreadSnapshot?.id, streamingThreadIds]);

  // Keep sidebar entry in sync with the latest active thread snapshot (title, metadata...)
  useEffect(() => {
    if (!activeThreadSnapshot?.id) {
      return;
    }

    // Don't sync stale snapshot after bulk delete
    if (postBulkDeleteRef.current) {
      return;
    }

    const exists = threads.some((t) => t.id === activeThreadSnapshot.id);
    if (exists) {
      updateThread(activeThreadSnapshot.id, (existing) => ({
        ...existing,
        ...activeThreadSnapshot,
        metadata: { ...existing.metadata, ...activeThreadSnapshot.metadata },
      }));
    } else {
      // Thread not in list yet, add it at the top (new thread created during this session)
      setNewlyCreatedThreadIds((prev) => new Set(prev).add(activeThreadSnapshot.id));
      addThread(activeThreadSnapshot);
    }
  }, [activeThreadSnapshot]);

  // Auto-refresh when currentThreadId changes to a thread not in the list
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!api || !currentThreadId) {
      prevThreadIdRef.current = currentThreadId;
      return;
    }

    if (prevThreadIdRef.current === currentThreadId) {
      return;
    }

    prevThreadIdRef.current = currentThreadId;

    const threadExists = threads.some((thread) => thread.id === currentThreadId);
    const snapshotHasThread = activeThreadSnapshot?.id === currentThreadId;

    if (!threadExists && !snapshotHasThread) {
      refetch();
    }
  }, [api, currentThreadId, threads, refetch, activeThreadSnapshot]);

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

      removeThread(threadId);

      if (currentThreadId === threadId) {
        onThreadDeleted?.(threadId);
      }
    } catch {
      // Delete failed
    } finally {
      setDeletingThreadId(null);
    }
  }, [api, currentThreadId, onThreadDeleted, removeThread]);

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

      updateThread(threadId, (thread) => ({ ...thread, title: trimmedTitle }));
    } catch {
      alert("Impossible de renommer la conversation.");
    }
  }, [api, updateThread]);

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
    let result: Thread[];
    if (isExpanded || searchQuery.trim()) {
      result = filteredThreads;
    } else {
      result = filteredThreads.slice(0, maxVisible);
    }

    // Helper to check if a thread should be added and add it if so
    const maybeAddThread = (thread: Thread | null) => {
      if (thread?.id && !result.some((t) => t.id === thread.id)) {
        const matchesSearch = !searchQuery.trim() ||
          getThreadTitle(thread).toLowerCase().includes(searchQuery.toLowerCase().trim());
        if (matchesSearch) {
          result = [thread, ...result];
        }
      }
    };

    // Don't add stale snapshots after bulk delete
    if (!postBulkDelete) {
      maybeAddThread(lastStreamingSnapshot);
      maybeAddThread(activeThreadSnapshot);
    }

    return result;
  }, [filteredThreads, isExpanded, maxVisible, searchQuery, activeThreadSnapshot, lastStreamingSnapshot, postBulkDelete]);

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
            onClick={() => refetch()}
          >
            Réessayer
          </button>
        </div>
      ) : displayedThreads.length === 0 && !isNewConversationActive ? (
        <p className="conversations-sidebar-section__empty">{emptyMessage}</p>
      ) : (
        <>
          <ul className="conversations-sidebar-section__list">
            {displayedThreads.map((thread) => {
              const items = normalizeItems(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const isStreaming = streamingThreadIds?.has(thread.id) ?? false;
              const snapshotTitle = isActive && activeThreadSnapshot?.id === thread.id
                ? (activeThreadSnapshot.title || (activeThreadSnapshot.metadata?.title as string | undefined))
                : undefined;
              const isFromSnapshot = (activeThreadSnapshot?.id === thread.id || lastStreamingSnapshot?.id === thread.id)
                && !threads.some((t) => t.id === thread.id);
              const isNewlyCreated = newlyCreatedThreadIds.has(thread.id) || (isFromSnapshot && isStreaming);
              const rawTitle = getThreadTitle(thread);
              const shouldHideDefaultTitle = isNewlyCreated && isStreaming && rawTitle === "Conversation sans titre";
              const threadTitle = snapshotTitle || (shouldHideDefaultTitle ? "" : rawTitle);

              const dateStr = items.length > 0 ? formatRelativeDate(items[0].created_at) : "";
              const isMenuOpen = openMenuId === thread.id;
              const menuId = `conversation-menu-${thread.id}`;
              const disableTitleAnimation = isStreaming || !isNewlyCreated;

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
                      <TruncatedText className="conversations-sidebar-section__thread-title">
                        <AnimatedTitle stableId={thread.id} disabled={disableTitleAnimation}>{threadTitle}</AnimatedTitle>
                      </TruncatedText>
                    </span>
                  </button>
                  {visibleSpinnerIds.has(thread.id) && (
                    <span className="conversations-sidebar-section__thread-spinner" aria-label="En cours" />
                  )}
                  <button
                    type="button"
                    className="conversations-sidebar-section__action-button"
                    data-conversation-menu-trigger=""
                    data-conversation-menu-container=""
                    aria-haspopup="true"
                    aria-expanded={isMenuOpen}
                    aria-controls={menuId}
                    disabled={isDeleting}
                    onClick={(e) => handleMenuTriggerClick(thread.id, e)}
                    style={{
                      position: 'absolute',
                      top: 0,
                      right: '8px',
                      background: 'transparent',
                      border: 'none',
                      borderRadius: 0,
                      boxShadow: 'none',
                      outline: 'none'
                    }}
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
              onClick={() => fetchNextPage()}
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
