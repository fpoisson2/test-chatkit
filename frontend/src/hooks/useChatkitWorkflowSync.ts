import { useCallback, useEffect, useRef, useState } from "react";

import type { WorkflowSummary } from "../types/workflows";
import { chatkitApi, type ChatKitWorkflowInfo } from "../utils/backend";

type UseChatkitWorkflowSyncParams = {
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  fetchUpdates: () => Promise<void>;
  sendUserMessage: (payload: { text: string; newThread?: boolean }) => Promise<unknown>;
  initialThreadId: string | null;
  reportError: (message: string, detail?: unknown) => void;
  enabled?: boolean;
  control?: { threadId: string | null; setThreadId: (id: string) => void };
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
  reportError,
  enabled = true,
  control,
}: UseChatkitWorkflowSyncParams): UseChatkitWorkflowSyncResult => {
  const [chatkitWorkflowInfo, setChatkitWorkflowInfo] = useState<ChatKitWorkflowInfo | null>(null);
  const autoStartAttemptRef = useRef(false);
  const fetchUpdatesRef = useRef<(() => Promise<void>) | null>(null);
  const controlRef = useRef(control);
  const lastVisibilityRefreshRef = useRef(0);
  const previousThreadIdRef = useRef<string | null>(initialThreadId);

  useEffect(() => {
    fetchUpdatesRef.current = fetchUpdates;
    controlRef.current = control;
    return () => {
      fetchUpdatesRef.current = null;
      controlRef.current = undefined;
    };
  }, [fetchUpdates, control]);

  const requestRefresh = useCallback(
    (context?: string) => {
      if (!enabled) {
        return undefined;
      }
      const refresh = fetchUpdatesRef.current;
      if (!refresh) {
        return undefined;
      }
      // Force a full thread reload for voice or outbound call transcriptions
      const ctrl = controlRef.current;
      const shouldForceReload =
        context?.includes('[Voice]') || context?.includes('[OutboundCall]');
      if (ctrl?.threadId && shouldForceReload) {
        if (import.meta.env.DEV) {
          console.log('[WorkflowSync] Forçant rechargement du thread pour transcriptions vocales ou sortantes', {
            threadId: ctrl.threadId,
          });
        }
        ctrl.setThreadId(ctrl.threadId);
      }
      return refresh().catch((err) => {
        if (import.meta.env.DEV && context) {
          console.warn(context, err);
        }
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
          if (import.meta.env.DEV) {
            console.warn(
              "[ChatKit] Impossible de charger le workflow actif pour déterminer le démarrage automatique.",
              err,
            );
          }
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
      return;
    }

    if (!chatkitWorkflowInfo || !chatkitWorkflowInfo.auto_start) {
      autoStartAttemptRef.current = false;
      return;
    }

    if (initialThreadId) {
      return;
    }

    if (autoStartAttemptRef.current) {
      return;
    }

    autoStartAttemptRef.current = true;

    const configuredMessage = chatkitWorkflowInfo.auto_start_user_message ?? "";
    const payloadText = configuredMessage.trim() ? configuredMessage : AUTO_START_TRIGGER_MESSAGE;

    sendUserMessage({ text: payloadText, newThread: true })
      .then(() =>
        requestRefresh("[ChatKit] Rafraîchissement après démarrage automatique impossible"),
      )
      .catch((err: unknown) => {
        autoStartAttemptRef.current = false;
        const message =
          err instanceof Error
            ? err.message
            : "Impossible de démarrer automatiquement le workflow.";
        if (import.meta.env.DEV) {
          console.warn("[ChatKit] Échec du démarrage automatique", err);
        }
        reportError(message, err);
      });
  }, [
    enabled,
    chatkitWorkflowInfo,
    initialThreadId,
    reportError,
    requestRefresh,
    sendUserMessage,
  ]);

  useEffect(() => {
    if (!enabled) {
      autoStartAttemptRef.current = false;
      previousThreadIdRef.current = initialThreadId;
      return;
    }

    if (previousThreadIdRef.current && !initialThreadId) {
      autoStartAttemptRef.current = false;
    }
    previousThreadIdRef.current = initialThreadId;
  }, [enabled, initialThreadId]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    let rafHandle: number | null = null;

    const refreshConversation = () => {
      const now = Date.now();
      if (now - lastVisibilityRefreshRef.current < 500) {
        return;
      }
      lastVisibilityRefreshRef.current = now;

      fetchUpdates().catch((err) => {
        if (import.meta.env.DEV) {
          console.warn("[ChatKit] Échec de la synchronisation après retour d'onglet", err);
        }
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
