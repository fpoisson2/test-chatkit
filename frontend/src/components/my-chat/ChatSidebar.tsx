import {
  ChatWorkflowSidebar,
  type WorkflowActivation,
} from "../../features/workflows/ChatWorkflowSidebar";

type ChatSidebarProps = {
  onWorkflowActivated: (
    selection: WorkflowActivation,
    options: { reason: "initial" | "user" },
  ) => void;
};

export const ChatSidebar = ({ onWorkflowActivated }: ChatSidebarProps) => (
  <ChatWorkflowSidebar onWorkflowActivated={onWorkflowActivated} />
);

export type { WorkflowActivation };
