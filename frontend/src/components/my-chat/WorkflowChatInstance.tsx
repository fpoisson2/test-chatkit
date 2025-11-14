import { useEffect, useRef, useState } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { ChatKitHost } from "./ChatKitHost";
import { useWorkflowChatSession } from "../../hooks/useWorkflowChatSession";
import type { WorkflowSummary } from "../../types/workflows";
import { useGenerationStatus } from "../../features/workflows/GenerationStatusContext";
import { chatkitApi } from "../../utils/backend";

type WorkflowChatInstanceProps = {
  workflowId: string;
  chatkitOptions: ChatKitOptions;
  token: string | null;
  activeWorkflow: WorkflowSummary | null;
  initialThreadId: string | null;
  reportError: (message: string, detail?: unknown) => void;
  mode: "local" | "hosted";
  isActive: boolean;
  onRequestRefreshReady?: (requestRefresh: () => Promise<void>) => void;
};

export const WorkflowChatInstance = ({
  workflowId,
  chatkitOptions,
  token,
  activeWorkflow,
  initialThreadId,
  reportError,
  mode,
  isActive,
  onRequestRefreshReady,
}: WorkflowChatInstanceProps) => {
  // Preserve the workflow that was active when this instance was created
  const [instanceWorkflow] = useState<WorkflowSummary | null>(activeWorkflow);

  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow: instanceWorkflow,
    initialThreadId,
    reportError,
    mode,
  });

  const requestRefreshRef = useRef(requestRefresh);
  const { setWorkflowGenerating } = useGenerationStatus();

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
  }, [requestRefresh]);

  useEffect(() => {
    if (isActive && onRequestRefreshReady) {
      onRequestRefreshReady(() => requestRefreshRef.current());
    }
  }, [isActive, onRequestRefreshReady]);

  // Monitor generation status from backend
  useEffect(() => {
    if (!isActive || !control || !token) {
      // Clean up when component becomes inactive
      setWorkflowGenerating(workflowId, false);
      return;
    }

    const threadId = control.threadId;
    if (!threadId) {
      setWorkflowGenerating(workflowId, false);
      return;
    }

    const checkGenerationStatus = async () => {
      try {
        const response = await chatkitApi.getGenerationStatus(token, threadId);
        setWorkflowGenerating(workflowId, response.is_generating);
      } catch (error) {
        // En cas d'erreur, ne pas afficher le spinner
        setWorkflowGenerating(workflowId, false);
      }
    };

    // Vérifier immédiatement
    void checkGenerationStatus();

    // Poll toutes les 500ms
    const intervalId = setInterval(() => {
      void checkGenerationStatus();
    }, 500);

    return () => {
      clearInterval(intervalId);
      setWorkflowGenerating(workflowId, false);
    };
  }, [isActive, control, control?.threadId, workflowId, setWorkflowGenerating, token]);

  return (
    <div
      style={{
        display: isActive ? "flex" : "none",
        flexDirection: "column",
        height: "100%",
        width: "100%",
      }}
      data-workflow-id={workflowId}
    >
      <ChatKitHost control={control} chatInstanceKey={0} />
    </div>
  );
};
