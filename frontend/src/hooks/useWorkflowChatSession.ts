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

  const noopRequestRefresh = useCallback(() => undefined, []);

  const workflowSync = useChatkitWorkflowSync({
    token,
    activeWorkflow,
    fetchUpdates,
    sendUserMessage,
    initialThreadId,
    reportError,
    enabled: mode !== "hosted",
  });

  const requestRefresh = mode === "hosted" ? noopRequestRefresh : workflowSync.requestRefresh;
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
