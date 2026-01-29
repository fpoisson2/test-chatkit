import { useCallback, useMemo } from "react";
import { useChatKit, type ChatKitOptions } from "../chatkit";

import type { WorkflowSummary } from "../types/workflows";
import { useChatkitWorkflowSync } from "./useChatkitWorkflowSync";

type UseWorkflowChatSessionOptions = {
  chatkitOptions: ChatKitOptions;
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  initialThreadId: string | null;
  reportError: (message: string, detail?: unknown) => void;
  mode: "local" | "hosted";
  autoStartEnabled?: boolean;
};

type UseWorkflowChatSessionResult = ReturnType<typeof useChatKit> & {
  requestRefresh: ReturnType<typeof useChatkitWorkflowSync>["requestRefresh"];
  chatkitWorkflowInfo: ReturnType<typeof useChatkitWorkflowSync>["chatkitWorkflowInfo"];
};

export const useWorkflowChatSession = ({
  chatkitOptions,
  token,
  activeWorkflow,
  initialThreadId,
  reportError,
  mode,
  autoStartEnabled = true,
}: UseWorkflowChatSessionOptions): UseWorkflowChatSessionResult => {
  const { control, fetchUpdates, sendUserMessage } = useChatKit(chatkitOptions);

  const hostedRequestRefresh = useCallback(
    (context?: string) => {
      if (import.meta.env.DEV) {
      }
      return fetchUpdates()
        .then((result) => {
          if (import.meta.env.DEV) {
          }
          return result;
        })
        .catch((err) => {
          if (import.meta.env.DEV) {
          }
        });
    },
    [fetchUpdates],
  );

  const workflowSync = useChatkitWorkflowSync({
    token,
    activeWorkflow,
    fetchUpdates,
    sendUserMessage,
    initialThreadId,
    thread: control.thread,
    reportError,
    enabled: true, // Always enabled to support workflow sync in both local and hosted modes
    autoStartEnabled,
    isStreaming: control.isLoading,
  });

  const requestRefresh = mode === "hosted" ? hostedRequestRefresh : workflowSync.requestRefresh;
  const chatkitWorkflowInfo = workflowSync.chatkitWorkflowInfo;

  return useMemo(
    () => ({
      control,
      fetchUpdates,
      sendUserMessage,
      requestRefresh,
      chatkitWorkflowInfo,
    }),
    [chatkitWorkflowInfo, control, fetchUpdates, requestRefresh, sendUserMessage],
  );
};

export type { UseWorkflowChatSessionOptions, UseWorkflowChatSessionResult };
