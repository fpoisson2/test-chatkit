import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import WorkflowBuilderPage from "../WorkflowBuilderPage";

const logoutMock = vi.hoisted(() => vi.fn());

vi.mock("../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { is_admin: true },
    logout: logoutMock,
  }),
}));

const makeApiEndpointCandidatesMock = vi.hoisted(() =>
  vi.fn<[string, string], string[]>(() => ["/api/workflows/current"]),
);

vi.mock("../../utils/backend", () => ({
  makeApiEndpointCandidates: makeApiEndpointCandidatesMock,
}));

describe("WorkflowBuilderPage", () => {
  const defaultResponse = {
    id: 1,
    name: "workflow",
    is_active: true,
    graph: {
      nodes: [
        {
          id: 1,
          slug: "start",
          kind: "start",
          display_name: "Début",
          agent_key: null,
          is_enabled: true,
          parameters: {},
          metadata: { position: { x: 0, y: 0 } },
        },
        {
          id: 2,
          slug: "agent-triage",
          kind: "agent",
          display_name: "Analyse",
          agent_key: "triage",
          is_enabled: true,
          parameters: {
            instructions: "Analyse les données fournies et signale les manques.",
            model: "gpt-4o",
            model_settings: {
              store: true,
              reasoning: { effort: "minimal", summary: "auto" },
            },
          },
          metadata: { position: { x: 240, y: 0 } },
        },
        {
          id: 3,
          slug: "writer",
          kind: "agent",
          display_name: "Rédaction",
          agent_key: "r_dacteur",
          is_enabled: true,
          parameters: {},
          metadata: { position: { x: 480, y: 0 } },
        },
        {
          id: 4,
          slug: "end",
          kind: "end",
          display_name: "Fin",
          agent_key: null,
          is_enabled: true,
          parameters: {},
          metadata: { position: { x: 720, y: 0 } },
        },
      ],
      edges: [
        { id: 1, source: "start", target: "agent-triage", condition: null, metadata: {} },
        { id: 2, source: "agent-triage", target: "writer", condition: null, metadata: {} },
        { id: 3, source: "writer", target: "end", condition: null, metadata: {} },
      ],
    },
  } as const;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("permet de modifier un nœud et d'enregistrer le graphe", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => defaultResponse,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    expect(container.querySelector('[data-id="start"]')).not.toBeNull();
    expect(container.querySelector('[data-id="end"]')).not.toBeNull();

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const displayNameInput = await screen.findByLabelText(/nom affiché/i);
    fireEvent.change(displayNameInput, { target: { value: "Analyse enrichie" } });

    const messageTextarea = await screen.findByLabelText(/message système/i);
    fireEvent.change(messageTextarea, {
      target: { value: "Analyse les entrées et produis un résumé clair." },
    });

    const modelInput = await screen.findByLabelText(/modèle openai/i);
    fireEvent.change(modelInput, { target: { value: "gpt-4.1-mini" } });

    const reasoningSelect = await screen.findByLabelText(/niveau de raisonnement/i);
    fireEvent.change(reasoningSelect, { target: { value: "medium" } });

    const parametersTextarea = await screen.findByLabelText(/paramètres json avancés/i);
    expect(parametersTextarea).toHaveValue(
      expect.stringContaining("Analyse les entrées et produis un résumé clair."),
    );

    const saveButton = screen.getByRole("button", { name: /enregistrer les modifications/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putCall = fetchMock.mock.calls[1];
    expect(putCall?.[0]).toBe("/api/workflows/current");
    expect(putCall?.[1]).toMatchObject({ method: "PUT" });

    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    expect(body).toHaveProperty("graph");
    const agentNode = body.graph.nodes.find((node: any) => node.slug === "agent-triage");
    expect(agentNode.display_name).toBe("Analyse enrichie");
    expect(agentNode.parameters).toEqual({
      instructions: "Analyse les entrées et produis un résumé clair.",
      model: "gpt-4.1-mini",
      model_settings: {
        store: true,
        reasoning: { effort: "medium", summary: "auto" },
      },
    });

    await screen.findByText(/workflow enregistré avec succès/i);
  });
});
