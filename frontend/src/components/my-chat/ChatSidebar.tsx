import { ChatWorkflowSidebar } from "../../features/workflows/ChatWorkflowSidebar";
import type { WorkflowSummary } from "../../types/workflows";

type ChatSidebarProps = {
  onWorkflowActivated: (
    workflow: WorkflowSummary | null,
    options: { reason: "initial" | "user"; mode: "local" | "hosted" },
  ) => void;
  hostedFlowEnabled: boolean;
};

export const ChatSidebar = ({ hostedFlowEnabled, onWorkflowActivated }: ChatSidebarProps) => (
  <ChatWorkflowSidebar
    hostedFlowEnabled={hostedFlowEnabled}
    onWorkflowActivated={onWorkflowActivated}
  />
);
