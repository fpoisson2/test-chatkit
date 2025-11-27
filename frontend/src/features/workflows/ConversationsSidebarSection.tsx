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
import "./ConversationsSidebarSection.css";

export interface ThreadWorkflowMetadata {
  id?: number;
  slug?: string;
  definition_id?: string;
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

  // --- NOUVEAUX ÉTATS POUR L'ANIMATION DE TITRE ---
  const [animatedTitle, setAnimatedTitle] = useState<string | null>(null); // Titre actuellement animé
  const [isAnimatingOut, setIsAnimatingOut] = useState(false); // Est-ce qu'on est en train de supprimer l'ancien titre ?
  const [isAnimatingIn, setIsAnimatingIn] = useState(false); // Est-ce qu'on est en train d'écrire le nouveau titre ?
  const prevIsNewConversationActiveRef = useRef(isNewConversationActive);
  const prevCurrentThreadIdRef = useRef(currentThreadId);
  // --------------------------------------------------

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

  // 1. Fusionner les threads du serveur avec le snapshot actif actuel (PRIORITÉ AU SNAPSHOT)
  // Cela empêche le serveur d'écraser le titre tant que le thread est actif
  const threadsWithActiveData = useMemo(() => {
    if (!activeThreadSnapshot?.id) return threads;

    return threads.map((thread) => {
      if (thread.id === activeThreadSnapshot.id) {
        // On écrase les données du serveur par celles du snapshot (plus fraîches)
        return {
          ...thread,
          ...activeThreadSnapshot,
          metadata: { ...thread.metadata, ...activeThreadSnapshot.metadata },
          // On s'assure que si le snapshot a des items, on les garde (pour le calcul de la date/titre)
          items: activeThreadSnapshot.items || thread.items
        };
      }
      return thread;
    });
  }, [threads, activeThreadSnapshot]);

  // 2. Filter threads by search query (Utiliser threadsWithActiveData au lieu de threads)
  const filteredThreads = useMemo(() => {
    const listToFilter = threadsWithActiveData;

    if (!searchQuery.trim()) {
      return listToFilter;
    }
    const query = searchQuery.toLowerCase().trim();
    return listToFilter.filter((thread) => {
      const title = getThreadTitle(thread).toLowerCase();
      return title.includes(query);
    });
  }, [threadsWithActiveData, searchQuery]);

// 3. Determine which threads to display (Optimistic Insert)
const displayedThreads = useMemo(() => {
    // Liste de base
    let list = isExpanded || searchQuery.trim()
        ? filteredThreads
        : filteredThreads.slice(0, maxVisible);

    // --- FIX OPTIMISTE ---
    // Si on a un ID actif mais qu'il n'est pas encore dans la liste (latence réseau création)
    // On n'ajoute pas ici si l'animation est en cours (isAnimatingOut ou isAnimatingIn).
    if (currentThreadId && !isNewConversationActive && !isAnimatingOut && !isAnimatingIn) { // 👈 AJOUT DE !isAnimatingIn
        const exists = list.some(t => t.id === currentThreadId);

        if (!exists) {
            // On utilise le snapshot s'il correspond, sinon un placeholder
            const snapshot = activeThreadSnapshot?.id === currentThreadId ? activeThreadSnapshot : null;

            const optimisticThread: Thread = snapshot ? { ...snapshot } : ({
                id: currentThreadId,
                title: snapshot?.title || "Conversation sans titre", // Mettre "Conversation sans titre" ici, car il sera géré en dessous
                created_at: new Date().toISOString(),
                items: [],
                metadata: {},
            } as unknown as Thread);

            return [optimisticThread, ...list];
        }
    }
    // ---------------------

    return list;
}, [filteredThreads, isExpanded, maxVisible, searchQuery, currentThreadId, isNewConversationActive, isAnimatingOut, isAnimatingIn, activeThreadSnapshot]); // 👈 AJOUT DE isAnimatingIn
  const hasHiddenThreads = filteredThreads.length > maxVisible && !isExpanded && !searchQuery.trim();

  // --- LOGIQUE D'ANIMATION DE TITRE ---
  useEffect(() => {
    const prevIsNew = prevIsNewConversationActiveRef.current;
    prevIsNewConversationActiveRef.current = isNewConversationActive;

    const prevThread = prevCurrentThreadIdRef.current;
    prevCurrentThreadIdRef.current = currentThreadId;

    // Condition pour démarrer l'animation:
    // 1. On était sur une "nouvelle conversation" (prevIsNew était true)
    // 2. On n'est PLUS sur une "nouvelle conversation" (isNewConversationActive est false)
    // 3. Un nouveau thread ID est maintenant actif (currentThreadId est non null et a changé)
    const shouldStartAnimation = prevIsNew && !isNewConversationActive && currentThreadId && (currentThreadId !== prevThread);

    if (shouldStartAnimation) {
      const newThreadTitle = getThreadTitle(activeThreadSnapshot || displayedThreads[0]);
      
      // On commence par "Nouvelle conversation" pour l'effet de destruction
      setAnimatedTitle("Nouvelle conversation");
      setIsAnimatingOut(true);

      let currentTitle = "Nouvelle conversation";
      let outIndex = currentTitle.length - 1;

      // Animation de suppression (typing out)
      const typeOutInterval = setInterval(() => {
        if (outIndex >= 0) {
          currentTitle = currentTitle.substring(0, outIndex);
          setAnimatedTitle(currentTitle);
          outIndex--;
        } else {
          clearInterval(typeOutInterval);
          setIsAnimatingOut(false);
          setIsAnimatingIn(true); // Passer à l'animation d'écriture
          
          let inIndex = 0;
          const targetTitle = newThreadTitle;
          let newAnimatingTitle = "";

          // Animation d'écriture (typing in)
          const typeInInterval = setInterval(() => {
            if (inIndex < targetTitle.length) {
              newAnimatingTitle += targetTitle[inIndex];
              setAnimatedTitle(newAnimatingTitle);
              inIndex++;
            } else {
              clearInterval(typeInInterval);
              setIsAnimatingIn(false);
              setAnimatedTitle(null); // Réinitialiser pour que le titre réel prenne le relais
            }
          }, 50); // Vitesse d'écriture (50ms par caractère)
        }
      }, 50); // Vitesse de suppression (50ms par caractère)
    }
  }, [isNewConversationActive, currentThreadId, activeThreadSnapshot, displayedThreads]); // Dépendances importantes

  // Si une animation est en cours, le titre de la "nouvelle conversation" doit être spécial
  const newConversationTitle = useMemo(() => {
    if (isAnimatingOut || isAnimatingIn) {
      return animatedTitle || ""; // Affiche le titre animé
    }
    return "Nouvelle conversation"; // Titre par défaut
  }, [animatedTitle, isAnimatingOut, isAnimatingIn]);
  // ------------------------------------


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
      ) : displayedThreads.length === 0 && !isNewConversationActive && !isAnimatingOut && !isAnimatingIn ? (
        // Ajouter les conditions d'animation pour masquer le message vide pendant l'animation
        <p className="conversations-sidebar-section__empty">{emptyMessage}</p>
      ) : (
        <>
          <ul className="conversations-sidebar-section__list">
            {/* Show draft "New conversation" entry when active */}
            {/* Condition modifiée pour inclure l'animation */}
            {(isNewConversationActive || isAnimatingOut || isAnimatingIn) && !searchQuery.trim() && (
              <li className="conversations-sidebar-section__item">
                <button
                  type="button"
                  // Rendre le bouton actif si c'est la "nouvelle conversation" standard ou si l'animation est en cours
                  className={`conversations-sidebar-section__thread-button ${isNewConversationActive || isAnimatingOut || isAnimatingIn ? "conversations-sidebar-section__thread-button--active" : ""}`}
                  aria-current="true"
                  // Désactiver le bouton pendant l'animation pour éviter les clics prématurés
                  disabled={isAnimatingOut || isAnimatingIn}
                  onClick={isNewConversationActive ? onNewConversation : undefined} // Le onClick doit être le onNewConversation initial
                >
                  <span className="conversations-sidebar-section__thread-title-row">
                    {/* Utilise le titre animé si l'animation est en cours */}
                    <TruncatedText className="conversations-sidebar-section__thread-title">
                      {newConversationTitle}
                    </TruncatedText>
                  </span>
                </button>
              </li>
            )}
            {displayedThreads.map((thread) => {
              // Si le thread actuel est celui qui est en cours d'animation,
              // et que l'animation est encore en train de "construire" le titre,
              // on ne l'affiche pas encore pour éviter le conflit.
              if ((isAnimatingOut || isAnimatingIn) && thread.id === currentThreadId) {
                return null;
              }

              const items = normalizeItems(thread);
              const isActive = thread.id === currentThreadId;
              const isDeleting = deletingThreadId === thread.id;
              const isStreaming = streamingThreadIds?.has(thread.id) ?? false;
              const dateStr = items.length > 0 ? formatRelativeDate(items[0].created_at) : "";
              const isMenuOpen = openMenuId === thread.id;
              const menuId = `conversation-menu-${thread.id}`;

              // --- NOUVELLE LOGIQUE POUR LE TITRE ---
              let threadTitle = getThreadTitle(thread);
              const isCurrentlyAnimating = isActive && isAnimatingIn; // Seulement si c'est le thread actif ET que l'on écrit le nouveau titre

              if (isCurrentlyAnimating) {
                  threadTitle = animatedTitle || "";
              }
              // ------------------------------------

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
                      <TruncatedText className="conversations-sidebar-section__thread-title">{threadTitle}</TruncatedText>
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