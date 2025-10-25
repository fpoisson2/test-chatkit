import { DEFAULT_END_MESSAGE } from "../../utils/workflows";

type WorkflowReference = {
  slug: string;
  id?: number;
};

type WorkflowNode = {
  slug: string;
  kind: string;
  display_name: string;
  is_enabled: boolean;
  parameters: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

type WorkflowEdge = {
  source: string;
  target: string;
  metadata: Record<string, unknown>;
};

export type HostedWorkflowGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  metadata: Record<string, unknown>;
};

export type CreateHostedWorkflowGraphParams = {
  identifier: string;
  agentLabel: string;
  agentInstructions: string;
  endMessage?: string;
};

const buildWorkflowReference = (identifier: string): WorkflowReference => {
  const trimmed = identifier.trim();
  const reference: WorkflowReference = { slug: trimmed };

  const numericCandidate = Number.parseInt(trimmed, 10);
  if (
    Number.isInteger(numericCandidate) &&
    numericCandidate > 0 &&
    String(numericCandidate) === trimmed
  ) {
    reference.id = numericCandidate;
  }

  return reference;
};

export const createHostedWorkflowGraph = ({
  identifier,
  agentLabel,
  agentInstructions,
  endMessage = DEFAULT_END_MESSAGE,
}: CreateHostedWorkflowGraphParams): HostedWorkflowGraph => {
  const trimmedIdentifier = identifier.trim();
  if (!trimmedIdentifier) {
    throw new Error("Hosted workflow identifier is required");
  }

  const workflowReference = buildWorkflowReference(trimmedIdentifier);

  const startNode: WorkflowNode = {
    slug: "start",
    kind: "start",
    display_name: "Début",
    is_enabled: true,
    parameters: {},
    metadata: {
      position: { x: 0, y: 0 },
    },
  };

  const agentNode: WorkflowNode = {
    slug: "hosted-agent",
    kind: "agent",
    display_name: agentLabel,
    is_enabled: true,
    parameters: {
      instructions: agentInstructions,
      workflow: workflowReference,
    },
    metadata: {
      position: { x: 320, y: 0 },
      hosted_workflow_identifier: trimmedIdentifier,
    },
  };

  const endNode: WorkflowNode = {
    slug: "end",
    kind: "end",
    display_name: "Fin",
    is_enabled: true,
    parameters: {
      message: endMessage,
      status: {
        type: "closed",
        reason: endMessage,
      },
    },
    metadata: {
      position: { x: 640, y: 0 },
    },
  };

  const edges: WorkflowEdge[] = [
    { source: "start", target: "hosted-agent", metadata: { label: "" } },
    { source: "hosted-agent", target: "end", metadata: { label: "" } },
  ];

  return {
    nodes: [startNode, agentNode, endNode],
    edges,
    metadata: {
      template: "hosted_workflow",
    },
  };
};

