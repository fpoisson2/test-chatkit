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
  onThreadNotFound: (params: { threadId: string }) => void;
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

      console.log("[DEBUG-CONV] onThreadChange called", {
        threadId,
        threadObjectId: thread?.id,
        resolvedThreadId,
        sessionOwner,
        persistenceSlug,
        workflowsCount,
        isNewConversationDraftRef: isNewConversationDraftRef.current,
        wasNewConversationStreamingRef: wasNewConversationStreamingRef.current,
        currentPath: window.location.pathname,
        timestamp: new Date().toISOString(),
        stack: new Error().stack?.split("\n").slice(1, 5).join("\n"),
      });

      // Check for null, undefined, or empty string
      if (!resolvedThreadId) {
        console.log("[DEBUG-CONV] onThreadChange: No resolvedThreadId, clearing storage");
        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
        // Reset workflow selection when creating new conversation with multiple workflows
        // This forces the user to choose a workflow before auto-start can trigger
        if (workflowsCount > 1) {
          setWorkflowSelection({ kind: "local", workflow: null });
          setChatInstanceKey((v) => v + 1);
        }
      } else {
        // IMPORTANT: If we're in "new conversation draft" mode AND this is NOT a newly created thread,
        // ignore stale thread callbacks. This prevents ChatKit from restoring an old thread after clicking "+".
        // However, if wasNewConversationStreamingRef is true, this is a NEW thread being created,
        // so we should accept it.
        if (isNewConversationDraftRef.current && !wasNewConversationStreamingRef.current) {
          console.log("[DEBUG-CONV] onThreadChange: IGNORED (new conversation draft mode, not a new thread)", { resolvedThreadId });
          return;
        }

        console.log("[DEBUG-CONV] onThreadChange: Setting thread", { resolvedThreadId });
        isNewConversationDraftRef.current = false;
        persistStoredThreadId(sessionOwner, resolvedThreadId, persistenceSlug);
        setInitialThreadId((current) => {
          console.log("[DEBUG-CONV] setInitialThreadId callback", { current, resolvedThreadId });
          return current === resolvedThreadId ? current : resolvedThreadId;
        });

        if (wasNewConversationStreamingRef.current) {
          setStreamingThreadIds((prev) => new Set(prev).add(resolvedThreadId));
          setIsNewConversationStreaming(false);
        }

        // Update URL without triggering React Router remount
        const currentPath = window.location.pathname;
        const newPath = `/c/${resolvedThreadId}`;
        if (currentPath !== newPath && !currentPath.includes(`/c/${resolvedThreadId}`)) {
          console.log("[DEBUG-CONV] onThreadChange: Updating URL", { currentPath, newPath });
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
        // Handle awaiting_action event to stop spinner when waiting for widget input
        if ("event" in data && data.event) {
          const event = data.event as Record<string, unknown>;
          if (event.type === "awaiting_action") {
            // Get the thread ID from the last snapshot or current thread
            const threadId = (lastThreadSnapshotRef.current?.id as string | undefined);
            if (threadId) {
              setStreamingThreadIds((prev) => {
                const next = new Set(prev);
                next.delete(threadId);
                return next;
              });
            }
          }
        }
      }
    },
    [lastThreadSnapshotRef, setCurrentThread, setStreamingThreadIds],
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

  const onThreadNotFound = useCallback(
    ({ threadId }: { threadId: string }) => {
      console.log("[DEBUG-CONV] onThreadNotFound called", {
        threadId,
        sessionOwner,
        persistenceSlug,
        timestamp: new Date().toISOString(),
      });

      // Clear stored thread ID since it no longer exists
      clearStoredThreadId(sessionOwner, persistenceSlug);

      // Set state for new conversation mode
      lastThreadSnapshotRef.current = null;
      isNewConversationDraftRef.current = true;
      wasNewConversationStreamingRef.current = false;

      // Reset to new conversation
      setInitialThreadId(null);
      setChatInstanceKey((v) => v + 1);

      // Reset workflow selection when multiple workflows exist
      if (workflowsCount > 1) {
        setWorkflowSelection({ kind: "local", workflow: null });
      }

      // Navigate to home page (new conversation)
      const currentPath = window.location.pathname;
      if (currentPath !== "/") {
        console.log("[DEBUG-CONV] onThreadNotFound: Navigating to /", { currentPath });
        window.history.replaceState(null, "", "/");
      }
    },
    [sessionOwner, persistenceSlug, workflowsCount, setInitialThreadId, setChatInstanceKey, setWorkflowSelection, lastThreadSnapshotRef, isNewConversationDraftRef, wasNewConversationStreamingRef],
  );

  return {
    onThreadChange,
    onResponseStart,
    onResponseEnd,
    onLog,
    onError,
    onThreadLoadStart,
    onThreadLoadEnd,
    onThreadNotFound,
  };
}
