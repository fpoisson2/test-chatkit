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

    // Skip if URL hasn't changed
    if (prevUrlThreadId === urlThreadId) {
      return;
    }

    const currentUrlThreadId = urlThreadId ?? null;

    // Navigate to specific thread
    if (currentUrlThreadId !== null && currentUrlThreadId !== initialThreadId) {
      isNewConversationDraftRef.current = false;
      persistStoredThreadId(sessionOwner, currentUrlThreadId, persistenceSlug);
      // Defer state updates to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        setInitialThreadId(currentUrlThreadId);
        setChatInstanceKey((v) => v + 1);
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    // Navigate to new conversation (URL cleared)
    if (currentUrlThreadId === null && prevUrlThreadId !== undefined) {
      clearStoredThreadId(sessionOwner, persistenceSlug);
      isNewConversationDraftRef.current = true;
      // Defer state updates to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        setInitialThreadId(null);
        setChatInstanceKey((v) => v + 1);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
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
