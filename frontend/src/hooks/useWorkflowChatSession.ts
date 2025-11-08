import { useCallback, useMemo } from "react";
import { ChatKit, type ChatKitControl } from "@openai/chatkit-react"-react";
import { ChatKit, type ChatKitControl } from "@openai/chatkit-react"";

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
      // Force a full thread reload by re-setting the thread ID
      // This ensures new items added directly to the store are visible
      const currentThread = control.threadId;
      const shouldForceReload =
        context?.includes('[Voice]') || context?.includes('[OutboundCall]');
      if (currentThread && shouldForceReload) {
        if (import.meta.env.DEV) {
          console.log('[WorkflowChat] Forçant rechargement du thread pour transcriptions vocales ou sortantes', {
            threadId: currentThread,
          });
        }
        control.setThreadId(currentThread);
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
    [control, fetchUpdates],
  );

  const workflowSync = useChatkitWorkflowSync({
    token,
    activeWorkflow,
    fetchUpdates,
    sendUserMessage,
    initialThreadId,
    reportError,
    enabled: mode !== "hosted",
    control,
  });

  const requestRefresh = mode === "hosted" ? hostedRequestRefresh : workflowSync.requestRefresh;
  const chatkitWorkflowInfo = mode === "hosted" ? null : workflowSync.chatkitWorkflowInfo;

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
