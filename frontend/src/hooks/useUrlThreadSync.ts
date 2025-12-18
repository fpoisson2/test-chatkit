import { useEffect } from "react";
import { useChatContext } from "../context/ChatContext";
import { clearStoredThreadId, persistStoredThreadId } from "../utils/chatkitThread";

export type UseUrlThreadSyncOptions = {
  urlThreadId: string | undefined;
  sessionOwner: string;
  persistenceSlug: string | null;
};

/**
 * Synchronizes URL thread ID changes with chat state.
 * Handles navigation to specific threads and new conversation creation.
 */
export function useUrlThreadSync({
  urlThreadId,
  sessionOwner,
  persistenceSlug,
}: UseUrlThreadSyncOptions): void {
  const { state, setters, refs } = useChatContext();
  const { initialThreadId } = state;
  const { setInitialThreadId, setChatInstanceKey } = setters;
  const { isNewConversationDraftRef, prevUrlThreadIdRef } = refs;

  useEffect(() => {
    const prevUrlThreadId = prevUrlThreadIdRef.current;
    prevUrlThreadIdRef.current = urlThreadId;

    console.log("[DEBUG-CONV] useUrlThreadSync effect", {
      prevUrlThreadId,
      urlThreadId,
      initialThreadId,
      isNewConversationDraftRef: isNewConversationDraftRef.current,
      timestamp: new Date().toISOString(),
    });

    // Skip if URL hasn't changed
    if (prevUrlThreadId === urlThreadId) {
      console.log("[DEBUG-CONV] useUrlThreadSync: SKIPPED (URL unchanged)");
      return;
    }

    const currentUrlThreadId = urlThreadId ?? null;

    // Navigate to specific thread
    if (currentUrlThreadId !== null && currentUrlThreadId !== initialThreadId) {
      console.log("[DEBUG-CONV] useUrlThreadSync: Navigate to thread", { currentUrlThreadId, initialThreadId });
      isNewConversationDraftRef.current = false;
      persistStoredThreadId(sessionOwner, currentUrlThreadId, persistenceSlug);
      // Defer state updates to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        console.log("[DEBUG-CONV] useUrlThreadSync: Deferred setInitialThreadId", { currentUrlThreadId });
        setInitialThreadId(currentUrlThreadId);
        setChatInstanceKey((v) => v + 1);
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    // Navigate to new conversation (URL cleared)
    if (currentUrlThreadId === null && prevUrlThreadId !== undefined) {
      console.log("[DEBUG-CONV] useUrlThreadSync: Navigate to new conversation (URL cleared)", { prevUrlThreadId, initialThreadId });
      clearStoredThreadId(sessionOwner, persistenceSlug);
      isNewConversationDraftRef.current = true;

      // Skip state updates if initialThreadId is already null (handleNewConversation already called them)
      // This prevents double-incrementing chatInstanceKey which causes multiple remounts
      if (initialThreadId === null) {
        console.log("[DEBUG-CONV] useUrlThreadSync: SKIPPED state updates (initialThreadId already null)");
        return;
      }

      // Defer state updates to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        console.log("[DEBUG-CONV] useUrlThreadSync: Deferred setInitialThreadId(null)");
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    console.log("[DEBUG-CONV] useUrlThreadSync: No action taken");
  }, [
    urlThreadId,
    initialThreadId,
    sessionOwner,
    persistenceSlug,
    setInitialThreadId,
    setChatInstanceKey,
    isNewConversationDraftRef,
    prevUrlThreadIdRef,
  ]);
}
