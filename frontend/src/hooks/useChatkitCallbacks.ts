import { useCallback } from "react";
import {
  clearStoredThreadId,
  persistStoredThreadId,
} from "../utils/chatkitThread";

export type ChatkitCallbackRefs = {
  lastThreadSnapshotRef: React.MutableRefObject<Record<string, unknown> | null>;
  wasNewConversationStreamingRef: React.MutableRefObject<boolean>;
  isNewConversationDraftRef: React.MutableRefObject<boolean>;
  requestRefreshRef: React.MutableRefObject<((context?: string) => Promise<void> | undefined) | null>;
};

export type ChatkitCallbackSetters = {
  setCurrentThread: React.Dispatch<React.SetStateAction<Record<string, unknown> | null>>;
  setStreamingThreadIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  setIsNewConversationStreaming: React.Dispatch<React.SetStateAction<boolean>>;
  setInitialThreadId: React.Dispatch<React.SetStateAction<string | null>>;
};

export type UseChatkitCallbacksOptions = {
  sessionOwner: string;
  persistenceSlug: string | null;
  refs: ChatkitCallbackRefs;
  setters: ChatkitCallbackSetters;
  reportError: (message: string, error?: Error) => void;
  resetError: () => void;
};

export type ChatkitCallbacks = {
  onThreadChange: (params: { threadId: string | null }) => void;
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
  refs,
  setters,
  reportError,
  resetError,
}: UseChatkitCallbacksOptions): ChatkitCallbacks {
  const {
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    isNewConversationDraftRef,
    requestRefreshRef,
  } = refs;

  const {
    setCurrentThread,
    setStreamingThreadIds,
    setIsNewConversationStreaming,
    setInitialThreadId,
  } = setters;

  const onThreadChange = useCallback(
    ({ threadId }: { threadId: string | null }) => {
      console.debug("[ChatKit] thread change", { threadId });
      if (threadId === null) {
        clearStoredThreadId(sessionOwner, persistenceSlug);
        setInitialThreadId(null);
      } else {
        isNewConversationDraftRef.current = false;
        persistStoredThreadId(sessionOwner, threadId, persistenceSlug);
        setInitialThreadId((current) => (current === threadId ? current : threadId));

        if (wasNewConversationStreamingRef.current) {
          setStreamingThreadIds((prev) => new Set(prev).add(threadId));
          setIsNewConversationStreaming(false);
        }
      }
    },
    [sessionOwner, persistenceSlug, setInitialThreadId, setStreamingThreadIds, setIsNewConversationStreaming, isNewConversationDraftRef, wasNewConversationStreamingRef],
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
      console.debug("[ChatKit] response end", { finalThreadId });
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
          const hasTitle = !!(thread.title || metadata?.title);
          console.log("[ChatKit] onLog thread update - title info:", {
            logName: entry.name,
            threadId: thread.id,
            title: thread.title,
            metadataTitle: metadata?.title,
            hasTitle,
          });
          setCurrentThread(thread);
        }
      }
    },
    [lastThreadSnapshotRef, setCurrentThread],
  );

  const onError = useCallback(
    ({ error }: { error: Error }) => {
      console.groupCollapsed("[ChatKit] onError");
      console.error("error:", error);
      if (lastThreadSnapshotRef.current) {
        console.log("thread snapshot:", lastThreadSnapshotRef.current);
      }
      console.groupEnd();
      reportError(error.message, error);
    },
    [lastThreadSnapshotRef, reportError],
  );

  const onThreadLoadStart = useCallback(({ threadId }: { threadId: string }) => {
    console.debug("[ChatKit] thread load start", { threadId });
  }, []);

  const onThreadLoadEnd = useCallback(({ threadId }: { threadId: string }) => {
    console.debug("[ChatKit] thread load end", { threadId });
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
