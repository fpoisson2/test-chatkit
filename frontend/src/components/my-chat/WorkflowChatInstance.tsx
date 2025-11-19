import { useEffect, useRef } from "react";
import type { ChatKitOptions } from "@openai/chatkit";

import { ChatKitHost } from "./ChatKitHost";
import { useWorkflowChatSession } from "../../hooks/useWorkflowChatSession";
import type { WorkflowSummary } from "../../types/workflows";

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
  // Use the activeWorkflow prop directly to reflect workflow changes from the builder
  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
    mode,
  });

  const requestRefreshRef = useRef(requestRefresh);

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
  }, [requestRefresh]);

  useEffect(() => {
    if (isActive && onRequestRefreshReady) {
      onRequestRefreshReady(() => requestRefreshRef.current());
    }
  }, [isActive, onRequestRefreshReady]);

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
