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
        console.log('[WorkflowChat] requestRefresh appelé', { context });
      }
      return fetchUpdates()
        .then((result) => {
          if (import.meta.env.DEV) {
            console.log('[WorkflowChat] fetchUpdates terminé avec succès', { context, result });
          }
          return result;
        })
        .catch((err) => {
          if (import.meta.env.DEV) {
            console.error('[WorkflowChat] fetchUpdates a échoué', { context, err });
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
    reportError,
    enabled: true, // Always enabled to support workflow sync in both local and hosted modes
    autoStartEnabled,
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
