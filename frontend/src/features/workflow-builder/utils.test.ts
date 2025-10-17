import { describe, expect, test } from "vitest";

import { resolveSelectionAfterLoad } from "./utils";

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
