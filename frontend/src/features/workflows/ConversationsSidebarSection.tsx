/**
 * ConversationsSidebarSection - Section displaying all conversations in the sidebar
 */
import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import type { Thread, ChatKitAPIConfig } from "../../chatkit/types";
import { listThreads, deleteThread, updateThreadTitle } from "../../chatkit/api/streaming/api";
import {
  type ActionMenuPlacement,
  computeWorkflowActionMenuPlacement,
  getActionMenuStyle,
  getActionMenuItemStyle,
} from "./WorkflowActionMenu";
import { TruncatedText } from "../../components/TruncatedText";
import "./ConversationsSidebarSection.css";

export interface ThreadWorkflowMetadata {
  id?: number;
  slug?: string;
  definition_id?: string;
}

export interface ConversationsSidebarSectionProps {
  api: ChatKitAPIConfig | null;
  currentThreadId: string | null;
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
  isNewConversationActive?: boolean;
}

let cachedThreads: Thread[] = [];
let cachedHasMore = true;

const normalizeItems = (thread: Thread) =>
  Array.isArray(thread.items) ? thread.items : (thread.items as any)?.data || [];

const getThreadTitle = (thread: Thread): string => {
  const metadataTitle = typeof thread.metadata?.title === "string" ? thread.metadata.title : null;
  const candidateTitle = (thread.title || metadataTitle)?.trim();
  if (candidateTitle) return candidateTitle;

  const items = normalizeItems(thread);
  const userMessage = items.find((item: any) => item.type === "user_message");
  if (userMessage?.content) {
    const textContent = userMessage.content.find((c: any) => c.type === "input_text");
    if (textContent?.text) {
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

  if (days === 0) return "Aujourd'hui";
  if (days === 1) return "Hier";
  if (days < 7) return `Il y a ${days} jours`;
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
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

  // Action menu state
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPlacement, setMenuPlacement] = useState<ActionMenuPlacement>("down");
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  // Suivi du titre précédent pour détecter les changements et animer
  const previousTitleRef = useRef<Map<string, string>>(new Map());

  const loadThreads = useCallback(async (isInitial = false, isRefresh = false) => {
    if (!api) return;
    if (isInitial && !isRefresh && cachedThreads.length === 0) setIsLoading(true);
    else if (!isInitial) setIsLoadingMore(true);

    setError(null);
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

      setThreads((current) => {
        const updated = (isInitial || isRefresh) ? newThreads : [...current, ...newThreads];
        cachedThreads = updated;
        return updated;
      });

      setHasMore(updatedHasMore);
      cachedHasMore = updatedHasMore;

      if (isInitial || isRefresh) {
        setAfter(newThreads.length > 0 ? newThreads[newThreads.length - 1].id : undefined);
      } else {
        setAfter((prev) => newThreads.length > 0 ? newThreads[newThreads.length - 1].id : prev);
      }
    } catch (err) {
      console.error("[ConversationsSidebarSection] Failed to load threads:", err);
      setError("Impossible de charger les conversations");
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [api, after]);

  useEffect(() => {
    if (api) loadThreads(true, cachedThreads.length > 0);
  }, [api?.url]);

  // Sync avec le thread actif (titre mis à jour par IA, etc.)
  useEffect(() => {
    if (!activeThreadSnapshot?.id) return;

    setThreads((current) => {
      const index = current.findIndex((t) => t.id === activeThreadSnapshot.id);
      if (index === -1) return current;

      const updated = {
        ...current[index],
        ...activeThreadSnapshot,
        metadata: { ...current[index].metadata, ...activeThreadSnapshot.metadata },
      };

      const next = [...current];
      next[index] = updated;
      cachedThreads = next;
      return next;
    });
  }, [activeThreadSnapshot]);

  // Auto-refresh si nouveau thread créé ailleurs
  const prevThreadIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!api || !currentThreadId || prevThreadIdRef.current === currentThreadId) {
      prevThreadIdRef.current = currentThreadId;
      return;
    }
    prevThreadIdRef.current = currentThreadId;

    if (!threads.some((t => t.id === currentThreadId)) {
      loadThreads(true, true);
    }
  }, [api, currentThreadId, threads, loadThreads]);

  const handleDeleteThread = useCallback(async (threadId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!api) return;
    if (!window.confirm("Supprimer cette conversation ?")) return;

    setDeletingThreadId(threadId);
    try {
      await deleteThread({ url: api.url, headers: api.headers, threadId });
      const updated = threads.filter(t => t.id !== threadId);
      setThreads(updated);
      cachedThreads = updated;
      if (currentThreadId === threadId) onThreadDeleted?.(threadId);
    } catch (err) {
      console.error(err);
    } finally {
      setDeletingThreadId(null);
    }
  }, [api, threads, currentThreadId, onThreadDeleted]);

  const handleRenameThread = useCallback(async (threadId: string, currentTitle: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!api) return;

    const newTitle = window.prompt("Nouveau nom de la conversation :", currentTitle);
    if (!newTitle || newTitle.trim() === "" || newTitle.trim() === currentTitle) return;

    const trimmed = newTitle.trim();
    try {
      await updateThreadTitle({
        url: api.url,
        headers: api.headers,
        threadId,
        title: trimmed,
      });

      setThreads(prev => prev.map(t =>
        t.id === threadId ? { ...t, title: trimmed } : t
      ));
      cachedThreads = cachedThreads.map(t =>
        t.id === threadId ? { ...t, title: trimmed } : t
      );
    } catch (err) {
      alert("Impossible de renommer la conversation.");
    }
  }, [api]);

  // Menu actions
  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuTriggerRef.current && !menuTriggerRef.current.contains(e.target as Node)
      ) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  const handleMenuTriggerClick = useCallback((threadId: string, e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    menuTriggerRef.current = e.currentTarget;
    if (openMenuId === threadId) {
      setOpenMenuId(null);
      return;
    }
    const placement = isMobileLayout ? computeWorkflowActionMenuPlacement(e.currentTarget) : "down";
    setMenuPlacement(placement);
    setOpenMenuId(threadId);
  }, [openMenuId, isMobileLayout]);

  // Filtre + affichage
  const filteredThreads = useMemo(() => {
    if (!searchQuery.trim()) return threads;
    const q = searchQuery.toLowerCase();
    return threads.filter(t => getThreadTitle(t).toLowerCase().includes(q));
  }, [threads, searchQuery]);

  const displayedThreads = useMemo(() => {
    if (isExpanded || searchQuery.trim()) return filteredThreads;
    return filteredThreads.slice(0, maxVisible);
  }, [filteredThreads, isExpanded, maxVisible, searchQuery]);

  const hasHiddenThreads = filteredThreads.length > maxVisible && !isExpanded && !searchQuery.trim();

  if (isCollapsed || !api) return null;

  return (
    <section className="conversations-sidebar-section" data-variant={isMobileLayout ? "overlay" : undefined}>
      <div className="chatkit-sidebar__section-header">
        <h2 id="conversations-section-title" className="chatkit-sidebar__section-title">{title}</h2>
        {onNewConversation && (
          <div className="chatkit-sidebar__section-floating-action">
            <button
              type="button"
              className="chatkit-sidebar__section-icon-button"
              onClick={onNewConversation}
              aria-label="Nouvelle conversation"
              title="Nouvelle conversation"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
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
          <button type="button" className="conversations-sidebar-section__retry" onClick={() => loadThreads(true, true)}>
            Réessayer
          </button>
        </div>
      ) : displayedThreads.length === 0 && !isNewConversationActive ? (
        <p className="conversations-sidebar-section__empty">{emptyMessage}</p>
      ) : (
        <>
          <ul className="conversations-sidebar-section__list">
            {isNewConversationActive && !searchQuery.trim() && (
              <li className="conversations-sidebar-section__item">
                <button type="button" className="conversations-sidebar-section__thread-button conversations-sidebar-section__thread-button--active" aria-current="true">
                  <span className="conversations-sidebar-section__thread-title-row">
                    <TruncatedText className="conversations-sidebar-section__thread-title">Nouvelle conversation</TruncatedText>
                  </span>
                </button>
              </li>
            )}

            {displayedThreads.map((thread) => {
              const threadTitle = getThreadTitle(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const isStreaming = streamingThreadIds?.has(thread.id) ?? false;
              const workflowMetadata = thread.metadata?.workflow as ThreadWorkflowMetadata | undefined;

              // Animation fluide quand le titre change
              const prevTitle = previousTitleRef.current.get(thread.id);
              const isTitleUpdating = prevTitle !== undefined && prevTitle !== threadTitle && !threadTitle.includes("…");
              if (prevTitle !== threadTitle) {
                previousTitleRef.current.set(thread.id, threadTitle);
              }

              return (
                <li key={thread.id} className="conversations-sidebar-section__item" data-has-actions="">
                  <button
                    type="button"
                    className={`conversations-sidebar-section__thread-button${isActive ? " conversations-sidebar-section__thread-button--active" : ""}`}
                    onClick={() => onThreadSelect(thread.id, workflowMetadata)}
                    disabled={isDeleting}
                    aria-current={isActive ? "true" : undefined}
                  >
                    <span className="conversations-sidebar-section__thread-title-row">
                      {isStreaming && <span className="conversations-sidebar-section__thread-spinner" aria-label="En cours" />}
                      <TruncatedText
                        className={`
                          conversations-sidebar-section__thread-title
                          ${isTitleUpdating ? "conversations-sidebar-section__thread-title--updating" : ""}
                        `.trim()}
                      >
                        {threadTitle}
                      </TruncatedText>
                    </span>
                  </button>

                  {/* Menu actions */}
                  <div className="conversations-sidebar-section__actions" data-conversation-menu-container="">
                    <button
                      type="button"
                      className="conversations-sidebar-section__action-button"
                      aria-haspopup="true"
                      aria-expanded={openMenuId === thread.id}
                      onClick={(e) => handleMenuTriggerClick(thread.id, e)}
                      disabled={isDeleting}
                    >
                      <span aria-hidden="true">…</span>
                      <span className="visually-hidden">Actions</span>
                    </button>

                    {openMenuId === thread.id && (
                      <div
                        role="menu"
                        className="conversations-sidebar-section__menu"
                        style={getActionMenuStyle(isMobileLayout, menuPlacement)}
                        ref={menuRef}
                      >
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleRenameThread(thread.id, threadTitle, e); }}
                          style={getActionMenuItemStyle(isMobileLayout)}
                        >
                          Renommer
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); setOpenMenuId(null); handleDeleteThread(thread.id, e); }}
                          style={getActionMenuItemStyle(isMobileLayout, { danger: true })}
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
            <button type="button" className="conversations-sidebar-section__show-more" onClick={() => setIsExpanded(true)}>
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