import { useCallback, useMemo } from "react";
import { useChatKit } from "@openai/chatkit-react";
import type { ChatKitOptions } from "@openai/chatkit";

import type { WorkflowSummary } from "../types/workflows";
import { useChatkitWorkflowSync } from "./useChatkitWorkflowSync";

type UseWorkflowChatSessionOptions = {
  chatkitOptions: ChatKitOptions;
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  initialThreadId: string | null;
  reportError: (message: string, detail?: unknown) => void;
  mode: "local" | "hosted";
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
    enabled: true, // Always enabled to support auto-start in both local and hosted modes
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
