import { describe, expect, it } from "vitest";

import { createHostedWorkflowGraph } from "../createHostedWorkflowGraph";

describe("createHostedWorkflowGraph", () => {
  it("includes a numeric identifier as both slug and id", () => {
    const graph = createHostedWorkflowGraph({
      identifier: "123",
      agentLabel: "Agent hébergé",
      agentInstructions: "Utilise le workflow distant.",
    });

    const hostedNode = graph.nodes.find((node) => node.slug === "hosted-agent");
    expect(hostedNode).toBeDefined();
    if (!hostedNode) {
      throw new Error("Hosted node missing");
    }
    const reference = ((hostedNode.parameters as Record<string, unknown>).workflow ?? null) as
      | { slug?: string; id?: number }
      | null;
    expect(reference).not.toBeNull();
    expect(reference?.id).toBe(123);
    expect(reference?.slug).toBe("123");
  });

  it("stores string identifiers as slugs without numeric coercion", () => {
    const graph = createHostedWorkflowGraph({
      identifier: "wf_abc123",
      agentLabel: "Agent hébergé",
      agentInstructions: "Utilise le workflow distant.",
    });

    const hostedNode = graph.nodes.find((node) => node.slug === "hosted-agent");
    expect(hostedNode).toBeDefined();
    if (!hostedNode) {
      throw new Error("Hosted node missing");
    }
    const reference = ((hostedNode.parameters as Record<string, unknown>).workflow ?? null) as
      | { slug?: string; id?: number }
      | null;
    expect(reference).not.toBeNull();
    expect(reference?.id).toBeUndefined();
    expect(reference?.slug).toBe("wf_abc123");
  });
});

