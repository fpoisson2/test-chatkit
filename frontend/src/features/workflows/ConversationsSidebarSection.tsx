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
  /** When true, a new conversation is being drafted (used for empty state logic) */
  isNewConversationActive?: boolean;
}

// Cache at module level to persist data between mounts
let cachedThreads: Thread[] = [];
let cachedHasMore = true;
// Cache the last streaming snapshot to persist spinner across remounts
let cachedLastStreamingSnapshot: Thread | null = null;

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
  const [threads, setThreads] = useState<Thread[]>(cachedThreads);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(cachedHasMore);
  const [after, setAfter] = useState<string | undefined>(undefined);
  const [deletingThreadId, setDeletingThreadId] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  // Track thread IDs that were created during this session (for title animation)
  const [newlyCreatedThreadIds, setNewlyCreatedThreadIds] = useState<Set<string>>(new Set());

  // Track if we just did a bulk delete (to ignore stale snapshots)
  const [postBulkDelete, setPostBulkDelete] = useState(false);

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
  // Initialize from cache to persist across remounts
  const [lastStreamingSnapshot, setLastStreamingSnapshotState] = useState<Thread | null>(cachedLastStreamingSnapshot);

  // Wrapper to update both state and cache
  const setLastStreamingSnapshot = useCallback((snapshot: Thread | null) => {
    cachedLastStreamingSnapshot = snapshot;
    setLastStreamingSnapshotState(snapshot);
  }, []);

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
        let updatedThreads = (isInitial || isRefresh) ? newThreads : [...currentThreads, ...newThreads];

        // Apply latest snapshot if available (to preserve title updates that arrived during load)
        const snapshot = latestSnapshotRef.current;
        if (snapshot?.id) {
          const snapshotIndex = updatedThreads.findIndex((t) => t.id === snapshot.id);
          if (snapshotIndex !== -1) {
            // Update existing thread with snapshot data
            const existing = updatedThreads[snapshotIndex];
            updatedThreads = [...updatedThreads];
            updatedThreads[snapshotIndex] = { ...existing, ...snapshot, metadata: { ...existing.metadata, ...snapshot.metadata } };
          } else {
            // Thread not in list yet, add it at the top
            updatedThreads = [snapshot, ...updatedThreads];
          }
        }

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
    } catch {
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

  // Listen for bulk conversation deletion events (from admin cleanup)
  useEffect(() => {
    const handleBulkDelete = () => {
      // Clear module-level cache
      cachedThreads = [];
      cachedHasMore = true;
      cachedLastStreamingSnapshot = null;
      // Reset local state and reload
      setThreads([]);
      setHasMore(true);
      setAfter(undefined);
      setLastStreamingSnapshot(null);
      // Ignore stale snapshots from parent until a new conversation is created
      setPostBulkDelete(true);
      if (api) {
        loadThreads(true, false);
      }
    };

    window.addEventListener("conversations-deleted", handleBulkDelete);
    return () => window.removeEventListener("conversations-deleted", handleBulkDelete);
  }, [api, loadThreads, setLastStreamingSnapshot]);

  // Keep a ref to the latest snapshot for use after loadThreads completes
  const latestSnapshotRef = useRef<Thread | null>(null);
  latestSnapshotRef.current = activeThreadSnapshot ?? null;

  // Update lastStreamingSnapshot when activeThreadSnapshot is streaming
  // This allows the spinner to persist even after clicking "+" to start a new conversation
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
  // This indicates a new conversation is being created after the bulk delete
  useEffect(() => {
    if (postBulkDelete && activeThreadSnapshot?.id && streamingThreadIds?.has(activeThreadSnapshot.id)) {
      setPostBulkDelete(false);
    }
  }, [postBulkDelete, activeThreadSnapshot?.id, streamingThreadIds]);

  // Keep sidebar entry in sync with the latest active thread snapshot (title, metadata...)
  useEffect(() => {
    if (!activeThreadSnapshot?.id) {
      return;
    }

    // Don't sync stale snapshot after bulk delete - it no longer exists in backend
    if (postBulkDelete) {
      return;
    }

    setThreads((currentThreads) => {
      const targetIndex = currentThreads.findIndex((thread) => thread.id === activeThreadSnapshot.id);

      // If thread doesn't exist yet, add it at the top (it's a new thread created during this session)
      if (targetIndex === -1) {
        // Mark this thread as newly created for title animation
        setNewlyCreatedThreadIds((prev) => new Set(prev).add(activeThreadSnapshot.id));
        const nextThreads = [activeThreadSnapshot, ...currentThreads];
        cachedThreads = nextThreads;
        return nextThreads;
      }

      const existing = currentThreads[targetIndex];
      const updated = { ...existing, ...activeThreadSnapshot, metadata: { ...existing.metadata, ...activeThreadSnapshot.metadata } };

      const nextThreads = [...currentThreads];
      nextThreads[targetIndex] = updated;
      cachedThreads = nextThreads;
      return nextThreads;
    });
  }, [activeThreadSnapshot, postBulkDelete]);

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

    // Also check if the activeThreadSnapshot already has this thread
    // This handles the race condition where the snapshot sync effect hasn't
    // updated the threads state yet, but we already have the thread data
    const snapshotHasThread = activeThreadSnapshot?.id === currentThreadId;

    // If the thread doesn't exist in our list AND we don't have it in the snapshot, refresh to fetch it
    if (!threadExists && !snapshotHasThread) {
      loadThreads(true, true);
    }
  }, [api, currentThreadId, threads, loadThreads, activeThreadSnapshot]);

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
    } catch {
      // Delete failed
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
    } catch {
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
  // Include activeThreadSnapshot and lastStreamingSnapshot at the top if not already in the list
  // This ensures the streaming spinner shows immediately when a new conversation starts
  // and persists even after clicking "+" to start a new conversation
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
        // Only add if it passes the search filter (if any)
        const matchesSearch = !searchQuery.trim() ||
          getThreadTitle(thread).toLowerCase().includes(searchQuery.toLowerCase().trim());
        if (matchesSearch) {
          result = [thread, ...result];
        }
      }
    };

    // Don't add stale snapshots after bulk delete (they no longer exist in backend)
    if (!postBulkDelete) {
      // Add lastStreamingSnapshot first (will appear after activeThreadSnapshot if both exist)
      // This handles the case where user clicked "+" while streaming
      maybeAddThread(lastStreamingSnapshot);

      // Add activeThreadSnapshot (will appear at top)
      // This handles the race condition where streamingThreadIds is updated
      // before the useEffect adds the thread to the threads list
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
            {displayedThreads.map((thread) => {
              const items = normalizeItems(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const isStreaming = streamingThreadIds?.has(thread.id) ?? false;
              // For active thread, prefer title from snapshot (most up-to-date source)
              const snapshotTitle = isActive && activeThreadSnapshot?.id === thread.id
                ? (activeThreadSnapshot.title || (activeThreadSnapshot.metadata?.title as string | undefined))
                : undefined;
              // Only animate title for threads created during this session (not on initial page load)
              // Also consider a thread newly created if it comes from a snapshot and is streaming
              // (this handles the race condition before the useEffect adds it to newlyCreatedThreadIds)
              const isFromSnapshot = (activeThreadSnapshot?.id === thread.id || lastStreamingSnapshot?.id === thread.id)
                && !threads.some((t) => t.id === thread.id);
              const isNewlyCreated = newlyCreatedThreadIds.has(thread.id) || (isFromSnapshot && isStreaming);
              // For newly created threads that are streaming, use empty string instead of default
              // This prevents the "Conversation sans titre" -> real title animation
              const rawTitle = getThreadTitle(thread);
              const shouldHideDefaultTitle = isNewlyCreated && isStreaming && rawTitle === "Conversation sans titre";
              const threadTitle = snapshotTitle || (shouldHideDefaultTitle ? "" : rawTitle);

              const dateStr = items.length > 0 ? formatRelativeDate(items[0].created_at) : "";
              const isMenuOpen = openMenuId === thread.id;
              const menuId = `conversation-menu-${thread.id}`;
              const disableTitleAnimation = isStreaming || !isNewlyCreated;

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
