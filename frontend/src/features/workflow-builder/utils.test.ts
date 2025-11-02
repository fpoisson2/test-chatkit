import { describe, expect, test } from "vitest";

import { buildGraphPayloadFrom, prepareNodeParametersForSave, resolveSelectionAfterLoad } from "./utils";
import { getParallelSplitBranches, getParallelSplitJoinSlug, resolveParallelSplitParameters } from "../../utils/workflows";
import type { FlowEdge, FlowNode, RepeatZone } from "./types";

describe("resolveSelectionAfterLoad", () => {
  test("conserve la sélection du nœud lors d'un rafraîchissement en arrière-plan", () => {
    const result = resolveSelectionAfterLoad({
      background: true,
      previousNodeId: "agent-triage",
      previousEdgeId: null,
      nodes: [{ id: "agent-triage" }, { id: "writer" }],
      edges: [{ id: "edge-1" }],
    });

    expect(result).toEqual({ nodeId: "agent-triage", edgeId: null });
  });

  test("conserve la sélection de l'arête lorsque le nœud n'existe plus", () => {
    const result = resolveSelectionAfterLoad({
      background: true,
      previousNodeId: "agent-triage",
      previousEdgeId: "edge-1",
      nodes: [{ id: "writer" }],
      edges: [{ id: "edge-1" }],
    });

    expect(result).toEqual({ nodeId: null, edgeId: "edge-1" });
  });

  test("réinitialise la sélection pour un chargement classique", () => {
    const result = resolveSelectionAfterLoad({
      background: false,
      previousNodeId: "agent-triage",
      previousEdgeId: "edge-1",
      nodes: [{ id: "agent-triage" }],
      edges: [{ id: "edge-1" }],
    });

    expect(result).toEqual({ nodeId: null, edgeId: null });
  });
});

describe("parallel split serialization", () => {
  const baseNode = (overrides: Partial<FlowNode> = {}): FlowNode => {
    const { data: dataOverrides, ...rest } = overrides;
    return {
      id: "node",
      position: { x: 0, y: 0 },
      data: {
        slug: "node",
        kind: "assistant_message",
        displayName: "Node",
        label: "Node",
        isEnabled: true,
        agentKey: null,
        parameters: {},
        parametersText: "{}",
        parametersError: null,
        metadata: {},
        ...(dataOverrides ?? {}),
      },
      draggable: true,
      ...rest,
    };
  };

  test("normalise les paramètres lors de l'export JSON", () => {
    const splitNode = baseNode({
      id: "parallel-split",
      position: { x: 10, y: 20 },
      data: {
        slug: "parallel-split",
        kind: "parallel_split",
        displayName: "Parallel Split",
        label: "Parallel Split",
        isEnabled: true,
        agentKey: null,
        parameters: {
          join_slug: " join-final  ",
          branches: [
            { slug: "branch-a", label: "  Branche A  " },
            { slug: "branch-b", label: "   " },
          ],
        },
        parametersText: "{}",
        parametersError: null,
        metadata: { foo: "bar" },
      },
    });

    const joinNode = baseNode({
      id: "parallel-join",
      data: {
        slug: "parallel-join",
        kind: "parallel_join",
        displayName: "Parallel Join",
        label: "Parallel Join",
        parameters: {},
        parametersText: "{}",
        parametersError: null,
        metadata: {},
      },
    });

    const assistantNode = baseNode({
      id: "assistant",
      data: {
        slug: "assistant",
        kind: "assistant_message",
        displayName: "Assistant",
        label: "Assistant",
        parameters: { message: "Bonjour" },
        parametersText: "{}",
        parametersError: null,
        metadata: {},
      },
    });

    const nodes: FlowNode[] = [splitNode, joinNode, assistantNode];
    const edges: FlowEdge[] = [
      {
        id: "edge-1",
        source: "parallel-split",
        target: "assistant",
        data: { metadata: {} },
      },
      {
        id: "edge-2",
        source: "assistant",
        target: "parallel-join",
        data: { metadata: {} },
      },
    ];

    const payload = buildGraphPayloadFrom(nodes, edges);
    const splitPayload = payload.nodes.find((node) => node.slug === "parallel-split");
    expect(splitPayload?.parameters).toEqual({
      join_slug: "join-final",
      branches: [
        { slug: "branch-a", label: "Branche A" },
        { slug: "branch-b" },
      ],
    });
  });

  test("hydrate les paramètres de split lors de l'import", () => {
    const parameters = resolveParallelSplitParameters({
      join_slug: " join-final ",
      branches: [
        { slug: "branch-a", label: "Branche A" },
        { slug: "branch-b" },
      ],
    });

    expect(getParallelSplitJoinSlug(parameters)).toBe("join-final");
    expect(getParallelSplitBranches(parameters)).toEqual([
      { slug: "branch-a", label: "Branche A" },
      { slug: "branch-b", label: "" },
    ]);
  });

  test("prepareNodeParametersForSave supprime les libellés vides", () => {
    const prepared = prepareNodeParametersForSave("parallel_split", {
      join_slug: "join-final",
      branches: [
        { slug: "branch-a", label: "Branche A" },
        { slug: "branch-b", label: "" },
      ],
    });

    expect(prepared).toEqual({
      join_slug: "join-final",
      branches: [
        { slug: "branch-a", label: "Branche A" },
        { slug: "branch-b" },
      ],
    });
  });
});

describe("repeat zone serialization", () => {
  test("inclut la zone de répétition et conserve les métadonnées", () => {
    const node: FlowNode = {
      id: "agent",
      position: { x: 120, y: 240 },
      data: {
        slug: "agent",
        kind: "agent",
        displayName: "Agent",
        label: "Agent",
        isEnabled: true,
        agentKey: "writer",
        parameters: {},
        parametersText: "{}",
        parametersError: null,
        metadata: { foo: "bar" },
      },
      draggable: true,
    } satisfies FlowNode;

    const zone: RepeatZone = {
      id: "loop-a",
      label: "Boucle",
      bounds: { x: 100, y: 200, width: 300, height: 180 },
      nodeSlugs: ["agent"],
      metadata: { max_iterations: 4 },
    };

    const payload = buildGraphPayloadFrom([node], [], [zone]);

    expect(payload.repeat_zones).toEqual([
      {
        id: "loop-a",
        label: "Boucle",
        bounds: { x: 100, y: 200, width: 300, height: 180 },
        node_slugs: ["agent"],
        metadata: { max_iterations: 4, order: 1 },
      },
    ]);
  });
});
