import { useEffect, useRef, useState } from "react";
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
