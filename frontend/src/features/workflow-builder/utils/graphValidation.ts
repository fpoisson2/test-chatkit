import type { FlowEdge, FlowNode } from "../../../utils/workflows";
import { getParallelSplitJoinSlug, getParallelSplitBranches } from "../../../utils/workflows";

/**
 * Validates the workflow graph structure for conditions and parallel splits/joins.
 *
 * @param nodes - Array of flow nodes in the workflow
 * @param edges - Array of flow edges connecting the nodes
 * @returns Error message if validation fails, null if validation passes
 */
export function validateGraphStructure(
  nodes: FlowNode[],
  edges: FlowEdge[]
): string | null {
  const enabledNodes = new Map(
    nodes.filter((node) => node.data.isEnabled).map((node) => [node.id, node]),
  );

  const joinAssignments = new Map<string, { slug: string; label: string }>();

  // Validate condition and parallel_split nodes
  for (const node of nodes) {
    if (!node.data.isEnabled) {
      continue;
    }

    const label = node.data.displayName.trim() || node.data.slug;

    if (node.data.kind === "condition") {
      const error = validateConditionNode(node, label, edges, enabledNodes);
      if (error) return error;
    }

    if (node.data.kind === "parallel_split") {
      const error = validateParallelSplitNode(
        node,
        label,
        edges,
        enabledNodes,
        joinAssignments
      );
      if (error) return error;
    }
  }

  // Validate parallel_join nodes
  for (const node of nodes) {
    if (!node.data.isEnabled || node.data.kind !== "parallel_join") {
      continue;
    }

    const label = node.data.displayName.trim() || node.data.slug;
    const error = validateParallelJoinNode(node, label, edges, enabledNodes, joinAssignments);
    if (error) return error;
  }

  return null;
}

/**
 * Validates a condition node to ensure it has at least 2 active outputs
 * and no duplicate branches.
 */
function validateConditionNode(
  node: FlowNode,
  label: string,
  edges: FlowEdge[],
  enabledNodes: Map<string, FlowNode>
): string | null {
  const outgoing = edges.filter(
    (edge) => edge.source === node.id && enabledNodes.has(edge.target),
  );

  if (outgoing.length < 2) {
    return `Le bloc conditionnel « ${label} » doit comporter au moins deux sorties actives.`;
  }

  const seenBranches = new Set<string>();
  let defaultCount = 0;

  for (const edge of outgoing) {
    const rawCondition = edge.data?.condition ?? "";
    const trimmed = rawCondition.trim();
    const normalized = trimmed ? trimmed.toLowerCase() : "default";

    if (normalized === "default") {
      defaultCount += 1;
      if (defaultCount > 1) {
        return `Le bloc conditionnel « ${label} » ne peut contenir qu'une seule branche par défaut.`;
      }
    }

    if (seenBranches.has(normalized)) {
      return `Le bloc conditionnel « ${label} » contient des branches conditionnelles en double.`;
    }

    seenBranches.add(normalized);
  }

  return null;
}

/**
 * Validates a parallel_split node to ensure it has at least 2 active outputs,
 * a valid join assignment, and the correct number of branches.
 */
function validateParallelSplitNode(
  node: FlowNode,
  label: string,
  edges: FlowEdge[],
  enabledNodes: Map<string, FlowNode>,
  joinAssignments: Map<string, { slug: string; label: string }>
): string | null {
  const outgoing = edges.filter(
    (edge) => edge.source === node.id && enabledNodes.has(edge.target),
  );

  if (outgoing.length < 2) {
    return `Le bloc split parallèle « ${label} » doit comporter au moins deux sorties actives.`;
  }

  const joinSlug = getParallelSplitJoinSlug(node.data.parameters);
  if (!joinSlug) {
    return `Le bloc split parallèle « ${label} » doit préciser une jointure valide.`;
  }

  const joinNode = enabledNodes.get(joinSlug);
  if (!joinNode || joinNode.data.kind !== "parallel_join") {
    return `Le bloc split parallèle « ${label} » doit référencer un bloc de jointure valide.`;
  }

  const joinLabel = joinNode.data.displayName.trim() || joinNode.data.slug;
  const previousAssignment = joinAssignments.get(joinSlug);
  if (previousAssignment && previousAssignment.slug !== node.id) {
    return `La jointure « ${joinLabel} » est déjà associée au split parallèle « ${previousAssignment.label} ».`;
  }
  joinAssignments.set(joinSlug, { slug: node.id, label });

  const branches = getParallelSplitBranches(node.data.parameters);
  if (branches.length !== outgoing.length) {
    return `Le bloc split parallèle « ${label} » doit définir autant de branches que de sorties actives.`;
  }

  return null;
}

/**
 * Validates a parallel_join node to ensure it has at least 2 active inputs
 * and is associated with a parallel_split.
 */
function validateParallelJoinNode(
  node: FlowNode,
  label: string,
  edges: FlowEdge[],
  enabledNodes: Map<string, FlowNode>,
  joinAssignments: Map<string, { slug: string; label: string }>
): string | null {
  const incoming = edges.filter(
    (edge) => edge.target === node.id && enabledNodes.has(edge.source),
  );

  if (incoming.length < 2) {
    return `Le bloc de jointure parallèle « ${label} » doit comporter au moins deux entrées actives.`;
  }

  if (!joinAssignments.has(node.id)) {
    return `Le bloc de jointure parallèle « ${label} » doit être associé à un split parallèle.`;
  }

  return null;
}
