import { useEffect, useRef, useState } from "react";
import type { ChatKitOptions } from "../../chatkit";

import { ChatKitHost } from "./ChatKitHost";
import { useWorkflowChatSession } from "../../hooks/useWorkflowChatSession";
import type { WorkflowSummary } from "../../types/workflows";

// Delay after content loads to allow Mermaid and other async content to render
const CONTENT_RENDER_DELAY_MS = 150;

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
  autoStartEnabled?: boolean;
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
  autoStartEnabled = true,
}: WorkflowChatInstanceProps) => {
  // Use the activeWorkflow prop directly to reflect workflow changes from the builder
  const { control, requestRefresh } = useWorkflowChatSession({
    chatkitOptions,
    token,
    activeWorkflow,
    initialThreadId,
    reportError,
    mode,
    autoStartEnabled,
  });

  const requestRefreshRef = useRef(requestRefresh);

  // Track if content is ready to be shown (after loading + render delay)
  const [isContentReady, setIsContentReady] = useState(false);
  const prevIsActiveRef = useRef(isActive);

  useEffect(() => {
    requestRefreshRef.current = requestRefresh;
  }, [requestRefresh]);

  useEffect(() => {
    if (isActive && onRequestRefreshReady) {
      onRequestRefreshReady(() => requestRefreshRef.current());
    }
  }, [isActive, onRequestRefreshReady]);

  // Wait for content to be ready before showing the instance
  useEffect(() => {
    // Reset content ready when becoming inactive
    if (!isActive) {
      setIsContentReady(false);
      prevIsActiveRef.current = false;
      return;
    }

    // If just became active, wait for content to load
    const justBecameActive = isActive && !prevIsActiveRef.current;
    prevIsActiveRef.current = isActive;

    if (justBecameActive) {
      // Check if content is loading
      const isLoading = control.isLoading || control.loadingThreadIds.size > 0;

      if (isLoading) {
        // Wait for loading to complete, then add render delay
        return; // Will re-run when loading state changes
      }

      // Content is loaded, add delay for Mermaid and other async renders
      const timer = setTimeout(() => {
        setIsContentReady(true);
      }, CONTENT_RENDER_DELAY_MS);

      return () => clearTimeout(timer);
    }

    // If already active and not loading, mark as ready
    const isLoading = control.isLoading || control.loadingThreadIds.size > 0;
    if (!isLoading && !isContentReady) {
      const timer = setTimeout(() => {
        setIsContentReady(true);
      }, CONTENT_RENDER_DELAY_MS);

      return () => clearTimeout(timer);
    }
  }, [isActive, control.isLoading, control.loadingThreadIds.size, isContentReady]);

  // Determine the CSS class based on active state AND content ready state
  const getInstanceClass = () => {
    if (!isActive) {
      return "chat-instance chat-instance--inactive";
    }
    // Active but content not ready - keep hidden
    if (!isContentReady) {
      return "chat-instance chat-instance--inactive";
    }
    // Active and content ready - show
    return "chat-instance chat-instance--active";
  };

  return (
    <div
      className={getInstanceClass()}
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        width: "100%",
        position: "absolute",
        top: 0,
        left: 0,
      }}
      data-workflow-id={workflowId}
    >
      <ChatKitHost control={control} options={chatkitOptions} chatInstanceKey={0} />
    </div>
  );
};
