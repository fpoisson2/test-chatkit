import { useCallback, useEffect, useRef, useState } from "react";

import { useAuth } from "./auth";
import { useAppLayout } from "./components/AppLayout";
import { ChatKitHost } from "./components/my-chat/ChatKitHost";
import { ChatSidebar } from "./components/my-chat/ChatSidebar";
import { ChatStatusMessage } from "./components/my-chat/ChatStatusMessage";
import { usePreferredColorScheme } from "./hooks/usePreferredColorScheme";
import { useChatkitSession } from "./hooks/useChatkitSession";
import { useHostedFlow } from "./hooks/useHostedFlow";
import { useWorkflowChatSession } from "./hooks/useWorkflowChatSession";
import { getOrCreateDeviceId } from "./utils/device";
import { clearStoredChatKitSecret } from "./utils/chatkitSession";
import {
  clearStoredThreadId,
  loadStoredThreadId,
  persistStoredThreadId,
} from "./utils/chatkitThread";
import type { WorkflowSummary } from "./types/workflows";
type ResetChatStateOptions = {
  workflowSlug?: string | null;
  preserveStoredThread?: boolean;
};

export function MyChat() {
  const { token, user } = useAuth();
  const { openSidebar } = useAppLayout();
  const preferredColorScheme = usePreferredColorScheme();
  const [deviceId] = useState(() => getOrCreateDeviceId());
  const sessionOwner = user?.email ?? deviceId;
  const [activeWorkflow, setActiveWorkflow] = useState<WorkflowSummary | null>(null);
  const activeWorkflowSlug = activeWorkflow?.slug ?? null;
  const [initialThreadId, setInitialThreadId] = useState<string | null>(() =>
    loadStoredThreadId(sessionOwner, activeWorkflowSlug),
  );
  const [chatInstanceKey, setChatInstanceKey] = useState(0);
  const previousSessionOwnerRef = useRef<string | null>(null);
  const resetChatState = useCallback(
    ({ workflowSlug, preserveStoredThread = false }: ResetChatStateOptions = {}) => {
      clearStoredChatKitSecret(sessionOwner);

      const resolvedWorkflowSlug = workflowSlug ?? activeWorkflowSlug;
      if (!preserveStoredThread) {
        clearStoredThreadId(sessionOwner, resolvedWorkflowSlug);
      }

      const nextInitialThreadId = preserveStoredThread
        ? loadStoredThreadId(sessionOwner, resolvedWorkflowSlug)
        : null;
      setInitialThreadId(nextInitialThreadId);
      setChatInstanceKey((value) => value + 1);
    },
    [activeWorkflowSlug, sessionOwner],
  );

  const { hostedFlowEnabled, disableHostedFlow } = useHostedFlow({
    onDisable: resetChatState,
  });

  const { getClientSecret, isLoading, error, reportError, resetError } = useChatkitSession({
    sessionOwner,
    token,
    hostedFlowEnabled,
    disableHostedFlow,
  });

  useEffect(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.documentElement.dataset.theme = preferredColorScheme;
  }, [preferredColorScheme]);

  const handleWorkflowActivated = useCallback(
    (workflow: WorkflowSummary | null, { reason }: { reason: "initial" | "user" }) => {
      setActiveWorkflow((current) => {
        const currentId = current?.id ?? null;
        const nextId = workflow?.id ?? null;

        if (reason === "user" && currentId !== nextId) {
          resetChatState({ workflowSlug: workflow?.slug, preserveStoredThread: true });
          resetError();
        }

        return workflow;
      });
    },
    [resetChatState, resetError],
  );

  useEffect(() => {
    const previousOwner = previousSessionOwnerRef.current;
    if (previousOwner && previousOwner !== sessionOwner) {
      clearStoredChatKitSecret(previousOwner);
      clearStoredThreadId(previousOwner, activeWorkflowSlug);
    }
    previousSessionOwnerRef.current = sessionOwner;

    const storedThreadId = loadStoredThreadId(sessionOwner, activeWorkflowSlug);
    setInitialThreadId((current) => (current === storedThreadId ? current : storedThreadId));
  }, [activeWorkflowSlug, sessionOwner]);

  

  const { control } = useWorkflowChatSession({
    workflow: activeWorkflow,
    token,
    chatInstanceKey,
    initialThreadId,
    setInitialThreadId,
    openSidebar,
    preferredColorScheme,
    getClientSecret,
    reportError,
    resetError,
    hostedFlowEnabled,
    onThreadPersist: (threadId, workflowSlug) => {
      persistStoredThreadId(sessionOwner, threadId, workflowSlug);
    },
  });

  const statusMessage = error ?? (isLoading ? "Initialisation de la session…" : null);

  return (
    <>
      <ChatSidebar onWorkflowActivated={handleWorkflowActivated} />
      <ChatKitHost control={control} chatInstanceKey={chatInstanceKey} />
      <ChatStatusMessage message={statusMessage} isError={Boolean(error)} isLoading={isLoading} />
    </>
  );
}
