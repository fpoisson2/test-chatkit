import {
  ChatWorkflowSidebar,
  type WorkflowActivation,
} from "../../features/workflows/WorkflowSidebar";
import type { HostedFlowMode } from "../../hooks/useHostedFlow";

type ChatSidebarProps = {
  mode: HostedFlowMode;
  setMode: (mode: HostedFlowMode) => void;
  onWorkflowActivated: (
    selection: WorkflowActivation,
    options: { reason: "initial" | "user" },
  ) => void;
};

export const ChatSidebar = ({ mode, setMode, onWorkflowActivated }: ChatSidebarProps) => (
  <ChatWorkflowSidebar mode={mode} setMode={setMode} onWorkflowActivated={onWorkflowActivated} />
);

export type { WorkflowActivation };
