import { useCallback, useEffect, useRef } from "react";
import type { WorkflowActivation } from "../features/workflows/WorkflowSidebar";
import type { HostedFlowMode } from "./useHostedFlow";
import { useChatContext } from "../context/ChatContext";
import { clearStoredChatKitSecret } from "../utils/chatkitSession";
import { clearStoredThreadId, loadStoredThreadId } from "../utils/chatkitThread";
import { resolvePersistenceSlug, buildSessionStorageKey } from "../utils/chatStorage";

export type ResetChatStateOptions = {
  selection?: WorkflowActivation | null;
  preserveStoredThread?: boolean;
  targetMode?: HostedFlowMode;
};

export type UseResetChatStateOptions = {
  mode: HostedFlowMode;
  sessionOwner: string;
  workflowSelection: WorkflowActivation;
};

export type UseResetChatStateReturn = {
  resetChatState: (options?: ResetChatStateOptions) => void;
  resetChatStateRef: React.MutableRefObject<((options?: ResetChatStateOptions) => void) | null>;
};

export function useResetChatState({
  mode,
  sessionOwner,
  workflowSelection,
}: UseResetChatStateOptions): UseResetChatStateReturn {
  // Get refs and setters from context
  const { setters, refs } = useChatContext();
  const {
    setCurrentThread,
    setStreamingThreadIds,
    setIsNewConversationStreaming,
    setInitialThreadId,
    setChatInstanceKey,
  } = setters;
  const {
    lastThreadSnapshotRef,
    wasNewConversationStreamingRef,
    stopVoiceSessionRef,
  } = refs;

  const resetChatStateRef = useRef<((options?: ResetChatStateOptions) => void) | null>(null);

  const resetChatState = useCallback(
    ({ selection, preserveStoredThread = false, targetMode }: ResetChatStateOptions = {}) => {
      const effectiveMode = targetMode ?? mode;
      const effectiveSelection = selection ?? workflowSelection;
      const resolvedSlug = resolvePersistenceSlug(effectiveMode, effectiveSelection);
      const storageKey = buildSessionStorageKey(sessionOwner, resolvedSlug);

      clearStoredChatKitSecret(storageKey);
      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, resolvedSlug);
      }

      lastThreadSnapshotRef.current = null;
      setCurrentThread(null);
      setStreamingThreadIds(new Set());
      setIsNewConversationStreaming(false);
      wasNewConversationStreamingRef.current = false;

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, resolvedSlug)
        : null;
      setInitialThreadId(nextInitialThreadId);
      setChatInstanceKey((v) => v + 1);
      stopVoiceSessionRef.current?.();
    },
    [
      mode,
      sessionOwner,
      workflowSelection,
      lastThreadSnapshotRef,
      wasNewConversationStreamingRef,
      stopVoiceSessionRef,
      setCurrentThread,
      setStreamingThreadIds,
      setIsNewConversationStreaming,
      setInitialThreadId,
      setChatInstanceKey,
    ],
  );

  useEffect(() => {
    resetChatStateRef.current = resetChatState;
    return () => {
      if (resetChatStateRef.current === resetChatState) {
        resetChatStateRef.current = null;
      }
    };
  }, [resetChatState]);

  return {
    resetChatState,
    resetChatStateRef,
  };
}
