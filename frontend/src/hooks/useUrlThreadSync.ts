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
  const { setInitialThreadId } = setters;
  const { isNewConversationDraftRef, prevUrlThreadIdRef } = refs;

  useEffect(() => {
    const prevUrlThreadId = prevUrlThreadIdRef.current;
    prevUrlThreadIdRef.current = urlThreadId;

    // Skip if URL hasn't changed
    if (prevUrlThreadId === urlThreadId) return;

    const currentUrlThreadId = urlThreadId ?? null;

    // Navigate to specific thread
    // Note: We don't call setChatInstanceKey here because ChatKit can handle
    // thread changes via initialThreadId prop without needing a full remount.
    // This prevents unnecessary layout shifts when switching between threads.
    if (currentUrlThreadId !== null && currentUrlThreadId !== initialThreadId) {
      isNewConversationDraftRef.current = false;
      persistStoredThreadId(sessionOwner, currentUrlThreadId, persistenceSlug);
      // Defer state update to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        setInitialThreadId(currentUrlThreadId);
      }, 0);
      return () => clearTimeout(timeoutId);
    }

    // Navigate to new conversation (URL cleared)
    // Note: We don't call setChatInstanceKey here because handleNewConversation
    // already handles the key increment. This prevents duplicate remounts.
    if (currentUrlThreadId === null && prevUrlThreadId !== undefined) {
      clearStoredThreadId(sessionOwner, persistenceSlug);
      isNewConversationDraftRef.current = true;
      // Defer state update to avoid updating parent during render
      const timeoutId = setTimeout(() => {
        setInitialThreadId(null);
      }, 0);
      return () => clearTimeout(timeoutId);
    }
  }, [
    urlThreadId,
    initialThreadId,
    sessionOwner,
    persistenceSlug,
    setInitialThreadId,
    isNewConversationDraftRef,
    prevUrlThreadIdRef,
  ]);
}
