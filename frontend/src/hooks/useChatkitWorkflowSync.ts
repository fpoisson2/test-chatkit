import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkflowSummary } from "../types/workflows";
import { chatkitApi, type ChatKitWorkflowInfo } from "../utils/backend";
import type { Thread } from "../chatkit/types";

type UseChatkitWorkflowSyncParams = {
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  fetchUpdates: () => Promise<void>;
  sendUserMessage: (content: string) => Promise<void>;
  initialThreadId: string | null;
  /** Thread actuel pour vérifier s'il est vide (pour auto-start en contexte LTI) */
  thread: Thread | null;
  reportError: (message: string, detail?: unknown) => void;
  enabled?: boolean;
  autoStartEnabled?: boolean;
  /** Si true, ne pas appeler fetchUpdates lors du retour de focus (streaming en cours) */
  isStreaming?: boolean;
};

type UseChatkitWorkflowSyncResult = {
  chatkitWorkflowInfo: ChatKitWorkflowInfo | null;
  requestRefresh: (context?: string) => Promise<void> | undefined;
};

const AUTO_START_TRIGGER_MESSAGE = "\u200B";

export const useChatkitWorkflowSync = ({
  token,
  activeWorkflow,
  fetchUpdates,
  sendUserMessage,
  initialThreadId,
  thread,
  reportError,
  enabled = true,
  autoStartEnabled = true,
  isStreaming = false,
}: UseChatkitWorkflowSyncParams): UseChatkitWorkflowSyncResult => {
  const [chatkitWorkflowInfo, setChatkitWorkflowInfo] = useState<ChatKitWorkflowInfo | null>(null);
  const autoStartAttemptRef = useRef(false);
  const fetchUpdatesRef = useRef<(() => Promise<void>) | null>(null);
  const lastVisibilityRefreshRef = useRef(0);
  const previousThreadIdRef = useRef<string | null>(initialThreadId);
  const isStreamingRef = useRef(isStreaming);

  // Keep isStreamingRef in sync
  isStreamingRef.current = isStreaming;

  useEffect(() => {
    fetchUpdatesRef.current = fetchUpdates;
    return () => {
      fetchUpdatesRef.current = null;
    };
  }, [fetchUpdates]);

  const requestRefresh = useCallback(
    (context?: string) => {
      if (!enabled) {
        return undefined;
      }
      const refresh = fetchUpdatesRef.current;
      if (!refresh) {
        return undefined;
      }
      return refresh().catch(() => {
        // Refresh error ignored
      });
    },
    [enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setChatkitWorkflowInfo(null);
      return;
    }

    if (!token) {
      setChatkitWorkflowInfo(null);
      return;
    }

    let cancelled = false;

    const loadWorkflowInfo = async () => {
      try {
        const info = await chatkitApi.getWorkflow(token);
        if (!cancelled) {
          setChatkitWorkflowInfo(info);
        }
      } catch (err) {
        if (!cancelled) {
          setChatkitWorkflowInfo(null);
        }
      }
    };

    void loadWorkflowInfo();

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    token,
    activeWorkflow?.id,
    activeWorkflow?.active_version_id,
    activeWorkflow?.updated_at,
  ]);

  useEffect(() => {
    if (!enabled) {
      autoStartAttemptRef.current = false;
      previousThreadIdRef.current = initialThreadId;
      return;
    }

    if (!autoStartEnabled) {
      autoStartAttemptRef.current = false;
      previousThreadIdRef.current = initialThreadId;
      return;
    }

    // Detect transition from existing thread to no thread (null)
    const isTransitionToNewThread = previousThreadIdRef.current !== null && initialThreadId === null;

    // Reset auto-start flag when transitioning to a new thread
    if (isTransitionToNewThread) {
      autoStartAttemptRef.current = false;
    }

    // Update previous thread ref for next comparison
    previousThreadIdRef.current = initialThreadId;

    // Auto-start conditions
    if (!chatkitWorkflowInfo || !chatkitWorkflowInfo.auto_start) {
      if (autoStartAttemptRef.current) {
        autoStartAttemptRef.current = false;
      }
      return;
    }

    // Auto-start when:
    // 1. No thread exists (fresh start) - initialThreadId === null
    // 2. Thread exists but is empty (LTI context where backend creates empty thread)
    const isNewThread = initialThreadId === null;
    const isEmptyExistingThread = initialThreadId !== null && thread !== null && thread.items.length === 0;

    if (!isNewThread && !isEmptyExistingThread) {
      return;
    }

    // Don't auto-start if already attempted (unless reset by transition)
    if (autoStartAttemptRef.current) {
      return;
    }

    // Trigger auto-start
    autoStartAttemptRef.current = true;

    const configuredMessage = chatkitWorkflowInfo.auto_start_user_message ?? "";
    const payloadText = configuredMessage.trim() ? configuredMessage : AUTO_START_TRIGGER_MESSAGE;

    sendUserMessage(payloadText)
      .then(() => {
        return requestRefresh("[ChatKit] Rafraîchissement après démarrage automatique impossible");
      })
      .catch((err: unknown) => {
        autoStartAttemptRef.current = false;
        const message =
          err instanceof Error
            ? err.message
            : "Impossible de démarrer automatiquement le workflow.";
        reportError(message, err);
      });
  }, [
    enabled,
    chatkitWorkflowInfo,
    initialThreadId,
    thread,
    reportError,
    requestRefresh,
    sendUserMessage,
    autoStartEnabled,
  ]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let rafHandle: number | null = null;

    const refreshConversation = () => {
      // Ne pas rafraîchir si un streaming est en cours pour éviter d'écraser le contenu streamé
      if (isStreamingRef.current) {
        return;
      }

      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 500) {
        return;
      }
      lastVisibilityRefreshRef.current = now;

      fetchUpdates().catch(() => {
        // Fetch error ignored
      });
    };

    const scheduleRefresh = () => {
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
      rafHandle = requestAnimationFrame(refreshConversation);
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        scheduleRefresh();
      }
    };

    const handleWindowFocus = () => {
      scheduleRefresh();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("focus", handleWindowFocus);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("focus", handleWindowFocus);
      if (rafHandle !== null) {
        cancelAnimationFrame(rafHandle);
      }
    };
  }, [enabled, fetchUpdates]);

  return { chatkitWorkflowInfo, requestRefresh };
};

export type { UseChatkitWorkflowSyncResult };
