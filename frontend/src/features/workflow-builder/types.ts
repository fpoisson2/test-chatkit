import type { Edge, Node } from "reactflow";

import type {
  AgentParameters,
  StateAssignment,
  StateAssignmentScope,
} from "../../utils/workflows";

export type NodeKind = "start" | "agent" | "condition" | "state" | "end";

export type ApiWorkflowNode = {
  id: number;
  slug: string;
  kind: NodeKind;
  display_name: string | null;
  agent_key: string | null;
  is_enabled: boolean;
  parameters: AgentParameters | null;
  metadata: Record<string, unknown> | null;
};

export type ApiWorkflowEdge = {
  id: number;
  source: string;
  target: string;
  condition: string | null;
  metadata: Record<string, unknown> | null;
};

export type WorkflowVersionResponse = {
  id: number;
  workflow_id: number;
  workflow_slug: string | null;
  workflow_display_name: string | null;
  workflow_is_chatkit_default: boolean;
  name: string | null;
  version: number;
  is_active: boolean;
  graph: {
    nodes: ApiWorkflowNode[];
    edges: ApiWorkflowEdge[];
  };
  steps: Array<{
    id: number;
    agent_key: string | null;
    position: number;
    is_enabled: boolean;
    parameters: AgentParameters;
    created_at: string;
    updated_at: string;
  }>;
  created_at: string;
  updated_at: string;
};

export type WorkflowSummary = {
  id: number;
  slug: string;
  display_name: string;
  description: string | null;
  active_version_id: number | null;
  active_version_number: number | null;
  is_chatkit_default: boolean;
  versions_count: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowVersionSummary = {
  id: number;
  workflow_id: number;
  name: string | null;
  version: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

export type FlowNodeData = {
  slug: string;
  kind: NodeKind;
  displayName: string;
  label: string;
  isEnabled: boolean;
  agentKey: string | null;
  parameters: AgentParameters;
  parametersText: string;
  parametersError: string | null;
  metadata: Record<string, unknown>;
};

export type FlowEdgeData = {
  condition?: string | null;
  metadata: Record<string, unknown>;
};

export type FlowNode = Node<FlowNodeData>;
export type FlowEdge = Edge<FlowEdgeData>;

export type SaveState = "idle" | "saving" | "saved" | "error";

export type {
  AgentParameters,
  FileSearchConfig,
  StateAssignment,
  StateAssignmentScope,
  WebSearchConfig,
} from "../../utils/workflows";
