import type { CSSProperties } from "react";
import { MarkerType, type EdgeOptions } from "@xyflow/react";

import { getParallelSplitBranches, getParallelSplitJoinSlug, getStateAssignments, stringifyAgentParameters as stringifyAgentParametersUtil } from "../../utils/workflows";
import type { AgentParameters } from "./types";
import type { FlowEdge, FlowNode, NodeKind } from "./types";

export { stringifyAgentParametersUtil as stringifyAgentParameters };

export const DEFAULT_WHILE_NODE_SIZE = { width: 400, height: 300 } as const;
export const WHILE_NODE_LAYER_INDEX = -10;

export const toFiniteDimension = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
};

export const extractWhileNodeSize = (
  metadata: Record<string, unknown> | null | undefined,
): { width: number; height: number } | null => {
  if (!metadata || typeof metadata !== "object") {
    return null;
  }

  const rawSize = (metadata as Record<string, unknown>).size;
  if (!rawSize || typeof rawSize !== "object") {
    return null;
  }

  const width = toFiniteDimension((rawSize as Record<string, unknown>).width);
  const height = toFiniteDimension((rawSize as Record<string, unknown>).height);

  if (width == null || height == null) {
    return null;
  }

  return { width, height };
};

export const getWhileNodeSizeFromStyle = (
  style: CSSProperties | undefined,
): { width: number; height: number } | null => {
  if (!style) {
    return null;
  }

  const width = toFiniteDimension(style.width);
  const height = toFiniteDimension(style.height);

  if (width == null || height == null) {
    return null;
  }

  return { width, height };
};

export const NODE_COLORS: Record<NodeKind, string> = {
  start: "#2563eb",
  agent: "#16a34a",
  voice_agent: "#f59e0b",
  outbound_call: "#6366f1",
  computer_use: "#8b5cf6",
  condition: "#f97316",
  state: "#0ea5e9",
  transform: "#8b5cf6",
  watch: "#facc15",
  wait_for_user_input: "#22d3ee",
  assistant_message: "#ef4444",
  user_message: "#14b8a6",
  docx_template: "#2563eb",
  json_vector_store: "#0891b2",
  parallel_split: "#84cc16",
  parallel_join: "#06b6d4",
  while: "#a855f7",
  widget: "#ec4899",
  end: "#7c3aed",
};

export const NODE_BACKGROUNDS: Record<NodeKind, string> = {
  start: "rgba(37, 99, 235, 0.12)",
  agent: "rgba(22, 163, 74, 0.12)",
  voice_agent: "rgba(245, 158, 11, 0.14)",
  outbound_call: "rgba(99, 102, 241, 0.16)",
  computer_use: "rgba(139, 92, 246, 0.16)",
  condition: "rgba(249, 115, 22, 0.14)",
  state: "rgba(14, 165, 233, 0.14)",
  transform: "rgba(139, 92, 246, 0.16)",
  watch: "rgba(250, 204, 21, 0.18)",
  wait_for_user_input: "rgba(34, 211, 238, 0.18)",
  assistant_message: "rgba(239, 68, 68, 0.14)",
  user_message: "rgba(20, 184, 166, 0.14)",
  docx_template: "rgba(37, 99, 235, 0.14)",
  json_vector_store: "rgba(8, 145, 178, 0.18)",
  parallel_split: "rgba(132, 204, 22, 0.16)",
  parallel_join: "rgba(6, 182, 212, 0.18)",
  while: "rgba(168, 85, 247, 0.16)",
  widget: "rgba(236, 72, 153, 0.15)",
  end: "rgba(124, 58, 237, 0.12)",
};

const NODE_GLOW_COLORS: Record<NodeKind, string> = {
  start: "rgba(37, 99, 235, 0.45)",
  agent: "rgba(22, 163, 74, 0.45)",
  voice_agent: "rgba(245, 158, 11, 0.45)",
  outbound_call: "rgba(99, 102, 241, 0.45)",
  computer_use: "rgba(139, 92, 246, 0.45)",
  condition: "rgba(249, 115, 22, 0.45)",
  state: "rgba(14, 165, 233, 0.45)",
  transform: "rgba(139, 92, 246, 0.45)",
  watch: "rgba(250, 204, 21, 0.5)",
  wait_for_user_input: "rgba(34, 211, 238, 0.5)",
  assistant_message: "rgba(239, 68, 68, 0.45)",
  user_message: "rgba(20, 184, 166, 0.45)",
  docx_template: "rgba(37, 99, 235, 0.45)",
  json_vector_store: "rgba(8, 145, 178, 0.5)",
  parallel_split: "rgba(132, 204, 22, 0.45)",
  parallel_join: "rgba(6, 182, 212, 0.5)",
  while: "rgba(168, 85, 247, 0.45)",
  widget: "rgba(236, 72, 153, 0.45)",
  end: "rgba(124, 58, 237, 0.45)",
};

export const buildEdgeStyle = (options: { isSelected?: boolean } = {}) => {
  const { isSelected = false } = options;
  return {
    stroke: "var(--text-color)",
    strokeWidth: isSelected ? 3 : 2,
  } satisfies CSSProperties;
};

export const defaultEdgeOptions: EdgeOptions = {
  type: "smart",
  markerEnd: { type: MarkerType.ArrowClosed, color: "var(--text-color)" },
  style: buildEdgeStyle(),
  labelStyle: { fill: "var(--text-color)", fontWeight: 600 },
  labelShowBg: true,
  labelBgPadding: [8, 4],
  labelBgBorderRadius: 6,
  labelBgStyle: { fill: "var(--color-surface-subtle)", stroke: "var(--surface-border)" },
};

export const connectionLineStyle = buildEdgeStyle();

const NON_REASONING_MODEL_PATTERN = /^gpt-4\.1/i;

export const supportsReasoningModel = (model: string): boolean => {
  if (!model.trim()) {
    return true;
  }
  return !NON_REASONING_MODEL_PATTERN.test(model.trim());
};

export const AUTO_SAVE_DELAY_MS = 800;

/**
 * Calculate parent_slug for each node based on spatial containment within while blocks
 */
const calculateParentSlugs = (flowNodes: FlowNode[]): Map<string, string | null> => {
  const parentMap = new Map<string, string | null>();

  // Find all while nodes
  const whileNodes = flowNodes.filter(node => node.data.kind === "while");

  // For each node, check if it's inside a while block
  for (const node of flowNodes) {
    if (node.data.kind === "while") {
      // While nodes don't have parents (or could be nested in another while)
      continue;
    }

    let containingWhile: FlowNode | null = null;
    let smallestArea = Infinity;

    // Check each while block
    for (const whileNode of whileNodes) {
      // Try to get size from style first, then from metadata
      const whileSize = getWhileNodeSizeFromStyle(whileNode.style)
        ?? extractWhileNodeSize(whileNode.data.metadata)
        ?? DEFAULT_WHILE_NODE_SIZE;

      const whileX = whileNode.position.x;
      const whileY = whileNode.position.y;
      const whileWidth = whileSize.width;
      const whileHeight = whileSize.height;

      const nodeX = node.position.x;
      const nodeY = node.position.y;

      // Check if node is inside this while block
      if (
        nodeX >= whileX &&
        nodeX <= whileX + whileWidth &&
        nodeY >= whileY &&
        nodeY <= whileY + whileHeight
      ) {
        // If nested whiles, use the smallest containing one
        const area = whileWidth * whileHeight;
        if (area < smallestArea) {
          smallestArea = area;
          containingWhile = whileNode;
        }
      }
    }

    parentMap.set(node.data.slug, containingWhile?.data.slug ?? null);
  }

  return parentMap;
};

export const buildGraphPayloadFrom = (flowNodes: FlowNode[], flowEdges: FlowEdge[]) => {
  const parentSlugs = calculateParentSlugs(flowNodes);

  return {
    nodes: flowNodes.map((node, index) => ({
      slug: node.data.slug,
      kind: node.data.kind,
      display_name: node.data.displayName.trim() || null,
      agent_key:
        node.data.kind === "agent" || node.data.kind === "voice_agent"
          ? node.data.agentKey
          : null,
      parent_slug: parentSlugs.get(node.data.slug) ?? null,
      is_enabled: node.data.isEnabled,
      parameters: prepareNodeParametersForSave(node.data.kind, node.data.parameters),
      metadata: {
        ...node.data.metadata,
        position: { x: node.position.x, y: node.position.y },
        order: index + 1,
        ...(node.data.kind === "while"
          ? (() => {
              const size = getWhileNodeSizeFromStyle(node.style);
              return size ? { size } : {};
            })()
          : {}),
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
  };
};

const STATE_ASSIGNMENT_SCOPES = ["globals", "state"] as const;

export const prepareNodeParametersForSave = (
  kind: NodeKind,
  parameters: AgentParameters,
): AgentParameters => {
  if (kind === "parallel_split") {
    const joinSlug = getParallelSplitJoinSlug(parameters);
    const branches = getParallelSplitBranches(parameters);
    const payload: Record<string, unknown> = {};
    if (joinSlug.trim()) {
      payload.join_slug = joinSlug.trim();
    }
    payload.branches = branches.map((branch) => {
      const trimmedLabel = branch.label.trim();
      return trimmedLabel
        ? { slug: branch.slug, label: trimmedLabel }
        : { slug: branch.slug };
    });
    return payload as AgentParameters;
  }

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

export const buildNodeStyle = (
  kind: NodeKind,
  options: { isSelected?: boolean } = {},
): CSSProperties => {
  const { isSelected = false } = options;
  const baseShadow = "var(--shadow-soft)";
  const selectionRingColor = "rgba(255, 255, 255, 0.92)";
  const haloShadow = `0 0 0 6px ${NODE_GLOW_COLORS[kind]}`;
  const ringShadow = `0 0 0 2px ${selectionRingColor}`;
  const style: CSSProperties = {
    padding: "0.75rem 1rem",
    borderRadius: "0.75rem",
    border: `2px solid ${NODE_COLORS[kind]}`,
    color: "var(--text-color)",
    background: NODE_BACKGROUNDS[kind],
    fontWeight: 600,
    minWidth: 160,
    textAlign: "center",
    overflow: "visible",
    transition: "box-shadow 0.2s ease, opacity 0.2s ease, filter 0.2s ease",
  };

  style.boxShadow = isSelected ? `${baseShadow}, ${ringShadow}, ${haloShadow}` : baseShadow;

  return style;
};

const NODE_KIND_LABEL_KEYS: Record<NodeKind, string> = {
  start: "workflowBuilder.node.kind.start",
  agent: "workflowBuilder.node.kind.agent",
  voice_agent: "workflowBuilder.node.kind.voice_agent",
  outbound_call: "workflowBuilder.node.kind.outbound_call",
  computer_use: "workflowBuilder.node.kind.computer_use",
  condition: "workflowBuilder.node.kind.condition",
  state: "workflowBuilder.node.kind.state",
  transform: "workflowBuilder.node.kind.transform",
  watch: "workflowBuilder.node.kind.watch",
  wait_for_user_input: "workflowBuilder.node.kind.wait_for_user_input",
  assistant_message: "workflowBuilder.node.kind.assistant_message",
  user_message: "workflowBuilder.node.kind.user_message",
  docx_template: "workflowBuilder.node.kind.docx_template",
  json_vector_store: "workflowBuilder.node.kind.json_vector_store",
  parallel_split: "workflowBuilder.node.kind.parallel_split",
  parallel_join: "workflowBuilder.node.kind.parallel_join",
  while: "workflowBuilder.node.kind.while",
  widget: "workflowBuilder.node.kind.widget",
  end: "workflowBuilder.node.kind.end",
};

export const labelForKind = (kind: NodeKind, translate?: (key: string) => string) => {
  const key = NODE_KIND_LABEL_KEYS[kind] ?? kind;
  return translate ? translate(key) : key;
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
