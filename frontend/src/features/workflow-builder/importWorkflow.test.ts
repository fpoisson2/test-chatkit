import { describe, expect, test } from "vitest";

import { parseWorkflowImport, WorkflowImportError } from "./importWorkflow";

describe("parseWorkflowImport", () => {
  test("extrait un graphe valide avec métadonnées optionnelles", () => {
    const json = JSON.stringify({
      nodes: [
        { slug: "start", kind: "start", parameters: { foo: "bar" }, metadata: { a: 1 } },
        { slug: "end", kind: "end", display_name: "Fin" },
      ],
      edges: [
        { source: "start", target: "end", metadata: { label: "" } },
      ],
      slug: "demo-workflow",
      display_name: "Demo workflow",
      description: "  description  ",
      workflow_id: 4,
      version_name: "Import",
      mark_as_active: true,
    });

    const result = parseWorkflowImport(json);

    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.slug).toBe("demo-workflow");
    expect(result.displayName).toBe("Demo workflow");
    expect(result.description).toBe("description");
    expect(result.workflowId).toBe(4);
    expect(result.versionName).toBe("Import");
    expect(result.markAsActive).toBe(true);
    expect(result.graph.nodes[0]).toMatchObject({
      slug: "start",
      kind: "start",
      parameters: { foo: "bar" },
      metadata: { a: 1 },
    });
  });

  test("accepte le format exporté avec graphe imbriqué", () => {
    const json = JSON.stringify({
      workflow_slug: "legacy",
      graph: {
        nodes: [
          { slug: "start", kind: "start" },
          { slug: "end", kind: "end" },
        ],
        edges: [{ source: "start", target: "end" }],
      },
    });

    const result = parseWorkflowImport(json);

    expect(result.graph.nodes.map((node) => node.slug)).toEqual(["start", "end"]);
    expect(result.slug).toBe("legacy");
  });

  test("signale une erreur JSON invalide", () => {
    expect(() => parseWorkflowImport("not-json")).toThrowError(WorkflowImportError);
    try {
      parseWorkflowImport("not-json");
    } catch (error) {
      expect(error).toBeInstanceOf(WorkflowImportError);
      expect((error as WorkflowImportError).reason).toBe("invalid_json");
    }
  });

  test("refuse un nœud sans identifiant", () => {
    const json = JSON.stringify({
      nodes: [{ kind: "start" }],
      edges: [],
    });

    expect(() => parseWorkflowImport(json)).toThrowError(WorkflowImportError);
  });

  test("refuse une connexion invalide", () => {
    const json = JSON.stringify({
      nodes: [
        { slug: "start", kind: "start" },
        { slug: "end", kind: "end" },
      ],
      edges: [{ source: "start", target: "" }],
    });

    expect(() => parseWorkflowImport(json)).toThrowError(WorkflowImportError);
  });
});
