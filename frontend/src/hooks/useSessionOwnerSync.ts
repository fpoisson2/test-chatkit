import { useEffect } from "react";
import { useChatContext } from "../context/ChatContext";
import { clearStoredChatKitSecret } from "../utils/chatkitSession";
import { clearStoredThreadId, loadStoredThreadId } from "../utils/chatkitThread";
import { buildSessionStorageKey } from "../utils/chatStorage";

export type UseSessionOwnerSyncOptions = {
  sessionOwner: string;
  persistenceSlug: string | null;
};

/**
 * Handles session owner changes (login/logout).
 * Clears previous owner's storage and loads new owner's thread.
 */
export function useSessionOwnerSync({
  sessionOwner,
  persistenceSlug,
}: UseSessionOwnerSyncOptions): void {
  const { setters, refs } = useChatContext();
  const { setInitialThreadId } = setters;
  const { isInitialMountRef, isNewConversationDraftRef, previousSessionOwnerRef } = refs;

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;

    // Clear previous owner's storage on owner change
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, "hosted"));
      clearStoredThreadId(previousOwner, "hosted");
      clearStoredChatKitSecret(buildSessionStorageKey(previousOwner, persistenceSlug));
      clearStoredThreadId(previousOwner, persistenceSlug);
    }

    previousSessionOwnerRef.current = sessionOwner;

    // Skip loading if not initial mount and in draft mode
    if (!isInitialMountRef.current && isNewConversationDraftRef.current) {
      return;
    }

    // Load stored thread for new session owner
    const storedThreadId = loadStoredThreadId(sessionOwner, persistenceSlug);
    if (storedThreadId) {
      isInitialMountRef.current = false;
      isNewConversationDraftRef.current = false;
      setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
    } else if (isInitialMountRef.current && persistenceSlug) {
      isInitialMountRef.current = false;
    }
  }, [
    persistenceSlug,
    sessionOwner,
    setInitialThreadId,
    isInitialMountRef,
    isNewConversationDraftRef,
    previousSessionOwnerRef,
  ]);
}
