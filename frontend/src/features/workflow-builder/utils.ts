import type { CSSProperties } from "react";
import { MarkerType, type EdgeOptions } from "reactflow";

import { getStateAssignments } from "../../utils/workflows";
import type { AgentParameters } from "./types";
import type { FlowEdge, FlowNode, NodeKind } from "./types";

export const NODE_COLORS: Record<NodeKind, string> = {
  start: "#2563eb",
  agent: "#16a34a",
  condition: "#f97316",
  state: "#0ea5e9",
  watch: "#facc15",
  json_vector_store: "#0891b2",
  widget: "#ec4899",
  message_assistant: "#ef4444",
  message_user: "#0ea5e9",
  wait_for_user_input: "#6366f1",
  end: "#7c3aed",
};

export const NODE_BACKGROUNDS: Record<NodeKind, string> = {
  start: "rgba(37, 99, 235, 0.12)",
  agent: "rgba(22, 163, 74, 0.12)",
  condition: "rgba(249, 115, 22, 0.14)",
  state: "rgba(14, 165, 233, 0.14)",
  watch: "rgba(250, 204, 21, 0.18)",
  json_vector_store: "rgba(8, 145, 178, 0.18)",
  widget: "rgba(236, 72, 153, 0.15)",
  message_assistant: "rgba(239, 68, 68, 0.16)",
  message_user: "rgba(14, 165, 233, 0.16)",
  wait_for_user_input: "rgba(99, 102, 241, 0.16)",
  end: "rgba(124, 58, 237, 0.12)",
};

export const defaultEdgeOptions: EdgeOptions = {
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
  style: { stroke: "var(--text-color)", strokeWidth: 2 },
  labelStyle: { fill: "var(--text-color)", fontWeight: 600 },
  labelShowBg: true,
  labelBgPadding: [8, 4],
  labelBgBorderRadius: 6,
  labelBgStyle: { fill: "var(--color-surface-subtle)", stroke: "var(--surface-border)" },
};

export const connectionLineStyle = { stroke: "var(--text-color)", strokeWidth: 2 };

const NON_REASONING_MODEL_PATTERN = /^gpt-4\.1/i;

export const supportsReasoningModel = (model: string): boolean => {
  if (!model.trim()) {
    return true;
  }
  return !NON_REASONING_MODEL_PATTERN.test(model.trim());
};

export const AUTO_SAVE_DELAY_MS = 800;

export const buildGraphPayloadFrom = (flowNodes: FlowNode[], flowEdges: FlowEdge[]) => ({
  nodes: flowNodes.map((node, index) => ({
    slug: node.data.slug,
    kind: node.data.kind,
    display_name: node.data.displayName.trim() || null,
    agent_key: node.data.kind === "agent" ? node.data.agentKey : null,
    is_enabled: node.data.isEnabled,
    parameters: prepareNodeParametersForSave(node.data.kind, node.data.parameters),
    metadata: {
      ...node.data.metadata,
      position: { x: node.position.x, y: node.position.y },
      order: index + 1,
    },
  })),
  edges: flowEdges.map((edge, index) => ({
    source: edge.source,
    target: edge.target,
    condition: edge.data?.condition ? edge.data.condition : null,
    metadata: {
      ...edge.data?.metadata,
      label: edge.label ?? "",
      order: index + 1,
    },
  })),
});

const STATE_ASSIGNMENT_SCOPES = ["globals", "state"] as const;

export const prepareNodeParametersForSave = (
  kind: NodeKind,
  parameters: AgentParameters,
): AgentParameters => {
  if (kind !== "state") {
    return parameters;
  }

  const preservedEntries = Object.entries(parameters ?? {}).filter(
    ([key]) => key !== "state" && key !== "globals",
  );

  const sanitized: Record<string, unknown> = Object.fromEntries(preservedEntries);

  for (const scope of STATE_ASSIGNMENT_SCOPES) {
    const assignments = getStateAssignments(parameters, scope)
      .map((assignment) => ({
        target: assignment.target.trim(),
        expression: assignment.expression.trim(),
      }))
      .filter((assignment) => assignment.target || assignment.expression);
    if (assignments.length > 0) {
      sanitized[scope] = assignments;
    }
  }

  return Object.keys(sanitized).length === 0 ? {} : (sanitized as AgentParameters);
};

export const buildNodeStyle = (kind: NodeKind): CSSProperties => ({
  padding: "0.75rem 1rem",
  borderRadius: "0.75rem",
  border: `2px solid ${NODE_COLORS[kind]}`,
  color: "var(--text-color)",
  background: NODE_BACKGROUNDS[kind],
  fontWeight: 600,
  minWidth: 160,
  textAlign: "center",
  boxShadow: "var(--shadow-soft)",
});

export const labelForKind = (kind: NodeKind) => {
  switch (kind) {
    case "start":
      return "Début";
    case "agent":
      return "Agent";
    case "condition":
      return "Condition";
    case "state":
      return "État";
    case "watch":
      return "Watch";
    case "json_vector_store":
      return "Stockage JSON";
    case "widget":
      return "Widget";
    case "message_assistant":
      return "Message assistant";
    case "message_user":
      return "Message utilisateur";
    case "wait_for_user_input":
      return "Attendre un message";
    case "end":
      return "Fin";
    default:
      return kind;
  }
};

export const slugifyWorkflowName = (label: string): string => {
  const normalized = label
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const slug = normalized.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  if (slug) {
    return slug;
  }
  return `workflow-${Date.now()}`;
};

export const humanizeSlug = (slug: string) =>
  slug.replace(/[-_]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());

export const extractPosition = (metadata: Record<string, unknown> | null | undefined) => {
  const position = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>).position : null;
  if (
    position &&
    typeof position === "object" &&
    "x" in position &&
    "y" in position &&
    typeof (position as Record<string, unknown>).x === "number" &&
    typeof (position as Record<string, unknown>).y === "number"
  ) {
    return { x: (position as { x: number }).x, y: (position as { y: number }).y };
  }
  return null;
};

export const formatDateTime = (value: string | null | undefined): string => {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  });
};

export type SelectionState = { nodeId: string | null; edgeId: string | null };

export const resolveSelectionAfterLoad = ({
  background,
  previousNodeId,
  previousEdgeId,
  nodes,
  edges,
}: {
  background: boolean;
  previousNodeId: string | null;
  previousEdgeId: string | null;
  nodes: Array<{ id: string }>;
  edges: Array<{ id: string }>;
}): SelectionState => {
  if (!background) {
    return { nodeId: null, edgeId: null };
  }

  if (previousNodeId && nodes.some((node) => node.id === previousNodeId)) {
    return { nodeId: previousNodeId, edgeId: null };
  }

  if (previousEdgeId && edges.some((edge) => edge.id === previousEdgeId)) {
    return { nodeId: null, edgeId: previousEdgeId };
  }

  return { nodeId: null, edgeId: null };
};
