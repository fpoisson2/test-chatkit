import { useCallback } from "react";
import { useChatContext } from "../context/ChatContext";
import {
  clearStoredThreadId,
  persistStoredThreadId,
} from "../utils/chatkitThread";

export type UseChatkitCallbacksOptions = {
  sessionOwner: string;
  persistenceSlug: string | null;
  reportError: (message: string, error?: Error) => void;
  resetError: () => void;
  workflowsCount?: number;
};

export type ChatkitCallbacks = {
  onThreadChange: (params: { threadId?: string | null; thread?: Record<string, unknown> }) => void;
  onResponseStart: (params: { threadId: string | null }) => void;
  onResponseEnd: (params: { threadId: string | null; finalThreadId: string | null }) => void;
  onLog: (entry: { name: string; data?: Record<string, unknown> }) => void;
  onError: (params: { error: Error }) => void;
  onThreadLoadStart: (params: { threadId: string }) => void;
  onThreadLoadEnd: (params: { threadId: string }) => void;
};

export function useChatkitCallbacks({
  sessionOwner,
  persistenceSlug,
  reportError,
  resetError,
  workflowsCount = 0,
}: UseChatkitCallbacksOptions): ChatkitCallbacks {
  // Get refs and setters from context
  const { setters, refs } = useChatContext();
  const {
    setCurrentThread,
    setStreamingThreadIds,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
    setWorkflowSelection,
  } = setters;
  const {
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
    requestRefreshRef,
  } = refs;

  const onThreadChange = useCallback(
    ({ threadId, thread }: { threadId?: string | null; thread?: Record<string, unknown> }) => {
      // Use threadId if provided, otherwise extract from thread object
      const resolvedThreadId = threadId ?? (thread?.id as string | undefined) ?? null;
      // Check for null, undefined, or empty string
      if (!resolvedThreadId) {
        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        // Reset workflow selection when creating new conversation with multiple workflows
        // This forces the user to choose a workflow before auto-start can trigger
        if (workflowsCount > 1) {
          setWorkflowSelection({ kind: "local", workflow: null });
          setChatInstanceKey((v) => v + 1);
        }
      } else {
        isNewConversationDraftRef.current = false;
        persistStoredThreadId(sessionOwner, resolvedThreadId, persistenceSlug);
        setInitialThreadId((current) => (current === resolvedThreadId ? current : resolvedThreadId));

        if (wasNewConversationStreamingRef.current) {
          setStreamingThreadIds((prev) => new Set(prev).add(resolvedThreadId));
          setIsNewConversationStreaming(false);
        }

        // Update URL without triggering React Router remount
        const currentPath = window.location.pathname;
        const newPath = `/c/${resolvedThreadId}`;
        if (currentPath !== newPath && !currentPath.includes(`/c/${resolvedThreadId}`)) {
          window.history.replaceState(null, "", newPath);
        }
      }
    },
    [sessionOwner, persistenceSlug, workflowsCount, setInitialThreadId, setStreamingThreadIds, setIsNewConversationStreaming, setWorkflowSelection, setChatInstanceKey, isNewConversationDraftRef, wasNewConversationStreamingRef],
  );

  const onResponseStart = useCallback(
    ({ threadId }: { threadId: string | null }) => {
      resetError();
      const isTempId = threadId?.startsWith("__temp_thread_");
      if (threadId === null || isTempId) {
        setIsNewConversationStreaming(true);
        wasNewConversationStreamingRef.current = true;
      } else {
        wasNewConversationStreamingRef.current = false;
        setStreamingThreadIds((prev) => new Set(prev).add(threadId));
      }
    },
    [resetError, setIsNewConversationStreaming, setStreamingThreadIds, wasNewConversationStreamingRef],
  );

  const onResponseEnd = useCallback(
    ({ finalThreadId }: { threadId: string | null; finalThreadId: string | null }) => {
      requestRefreshRef.current?.("[ChatKit] Échec de la synchronisation après la réponse");
      setIsNewConversationStreaming(false);
      wasNewConversationStreamingRef.current = false;
      if (finalThreadId) {
        setStreamingThreadIds((prev) => {
          const next = new Set(prev);
          next.delete(finalThreadId);
          return next;
        });
      }
    },
    [requestRefreshRef, setIsNewConversationStreaming, setStreamingThreadIds, wasNewConversationStreamingRef],
  );

  const onLog = useCallback(
    (entry: { name: string; data?: Record<string, unknown> }) => {
      if (entry?.data && typeof entry.data === "object") {
        const data = entry.data as Record<string, unknown>;
        if ("thread" in data && data.thread) {
          const thread = data.thread as Record<string, unknown>;
          lastThreadSnapshotRef.current = thread;
          const metadata = thread.metadata as Record<string, unknown> | undefined;
          setCurrentThread(thread);
        }
      }
    },
    [lastThreadSnapshotRef, setCurrentThread],
  );

  const onError = useCallback(
    ({ error }: { error: Error }) => {
      reportError(error.message, error);
    },
    [reportError],
  );

  const onThreadLoadStart = useCallback(({ threadId }: { threadId: string }) => {
  }, []);

  const onThreadLoadEnd = useCallback(({ threadId }: { threadId: string }) => {
  }, []);

  return {
    onThreadChange,
    onResponseStart,
    onResponseEnd,
    onLog,
    onError,
    onThreadLoadStart,
    onThreadLoadEnd,
  };
}
