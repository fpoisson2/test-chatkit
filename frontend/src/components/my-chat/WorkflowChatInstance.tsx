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
  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
    mode,
  });

  const requestRefreshRef = useRef(requestRefresh);
  const previousWorkflowRef = useRef<WorkflowSummary | null>(activeWorkflow);
  const pendingActivationRefreshRef = useRef(false);

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
  }, [requestRefresh]);

  useEffect(() => {
    if (isActive && onRequestRefreshReady) {
      onRequestRefreshReady(() => requestRefreshRef.current());
    }
  }, [isActive, onRequestRefreshReady]);

  useEffect(() => {
    const previousWorkflow = previousWorkflowRef.current;
    const hasWorkflowChanged =
      (previousWorkflow?.id ?? null) !== (activeWorkflow?.id ?? null) ||
      previousWorkflow?.active_version_id !== activeWorkflow?.active_version_id ||
      previousWorkflow?.updated_at !== activeWorkflow?.updated_at;

    if ((previousWorkflow && hasWorkflowChanged) || (!previousWorkflow && activeWorkflow)) {
      if (isActive) {
        void requestRefreshRef.current?.(
          "[WorkflowChatInstance] Workflow change detected, refreshing session",
        );
      } else {
        pendingActivationRefreshRef.current = true;
      }
    }

    previousWorkflowRef.current = activeWorkflow;
  }, [activeWorkflow, isActive]);

  useEffect(() => {
    if (!isActive || !pendingActivationRefreshRef.current) {
      return;
    }

    pendingActivationRefreshRef.current = false;
    void requestRefreshRef.current?.(
      "[WorkflowChatInstance] Activated with pending workflow change, refreshing session",
    );
  }, [isActive]);

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
      <ChatKitHost control={control} />
    </div>
  );
};
