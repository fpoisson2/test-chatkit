import { ChatWorkflowSidebar } from "../../features/workflows/ChatWorkflowSidebar";
import type { WorkflowSummary } from "../../types/workflows";

type ChatSidebarProps = {
  onWorkflowActivated: (
    workflow: WorkflowSummary | null,
    options: { reason: "initial" | "user" },
  ) => void;
};

export const ChatSidebar = ({ onWorkflowActivated }: ChatSidebarProps) => (
  <ChatWorkflowSidebar onWorkflowActivated={onWorkflowActivated} />
);
