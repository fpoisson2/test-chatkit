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
          parameters: {},
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

    await waitFor(() => {
      expect(screen.queryByLabelText(/niveau de raisonnement/i)).toBeNull();
    });

    const temperatureInput = await screen.findByLabelText(/température/i);
    fireEvent.change(temperatureInput, { target: { value: "0.6" } });

    const topPInput = await screen.findByLabelText(/top-p/i);
    fireEvent.change(topPInput, { target: { value: "0.8" } });

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
        temperature: 0.6,
        top_p: 0.8,
      },
    });

    await screen.findByText(/workflow enregistré avec succès/i);
  });

  test("pré-remplit un agent hérité avec les valeurs par défaut", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => JSON.parse(JSON.stringify(defaultResponse)),
    } as Response);

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const messageTextarea = await screen.findByLabelText(/message système/i);
    expect(messageTextarea).toHaveValue(
      expect.stringContaining(
        "Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.",
      ),
    );

    const modelInput = await screen.findByLabelText(/modèle openai/i);
    expect(modelInput).toHaveValue("gpt-5");

    const reasoningSelect = await screen.findByLabelText(/niveau de raisonnement/i);
    expect(reasoningSelect).toHaveValue("minimal");

    const writerNode = container.querySelector('[data-id="writer"]');
    expect(writerNode).not.toBeNull();
    fireEvent.click(writerNode!);

    await waitFor(() => {
      expect(screen.queryByLabelText(/niveau de raisonnement/i)).toBeNull();
    });

    const writerTemperature = await screen.findByLabelText(/température/i);
    expect(writerTemperature).toHaveValue(1);

    const writerTopP = await screen.findByLabelText(/top-p/i);
    expect(writerTopP).toHaveValue(1);
  });

  test("permet de configurer le schéma JSON et les outils", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => JSON.parse(JSON.stringify(defaultResponse)),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="writer"]')).not.toBeNull();
    });

    const writerNode = container.querySelector('[data-id="writer"]');
    expect(writerNode).not.toBeNull();
    fireEvent.click(writerNode!);

    const responseTypeSelect = await screen.findByLabelText(/type de sortie/i);
    fireEvent.change(responseTypeSelect, { target: { value: "json_schema" } });

    const schemaNameInput = await screen.findByLabelText(/nom du schéma json/i);
    fireEvent.change(schemaNameInput, { target: { value: "planCadre" } });

    const schemaTextarea = await screen.findByLabelText(/définition du schéma json/i);
    const schema = {
      type: "object",
      properties: {
        titre: { type: "string" },
      },
      required: ["titre"],
    } as const;
    fireEvent.change(schemaTextarea, { target: { value: JSON.stringify(schema, null, 2) } });

    const webSearchToggle = await screen.findByLabelText(/activer la recherche web/i);
    fireEvent.click(webSearchToggle);

    const searchScopeSelect = await screen.findByLabelText(/portée de la recherche/i);
    fireEvent.change(searchScopeSelect, { target: { value: "large" } });

    const cityInput = await screen.findByLabelText(/ville/i);
    fireEvent.change(cityInput, { target: { value: "Montréal" } });

    const countryInput = await screen.findByLabelText(/pays/i);
    fireEvent.change(countryInput, { target: { value: "CA" } });

    const saveButton = screen.getByRole("button", { name: /enregistrer les modifications/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const putCall = fetchMock.mock.calls[1];
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const writerPayload = body.graph.nodes.find((node: any) => node.slug === "writer");
    expect(writerPayload.parameters.response_format).toEqual({
      type: "json_schema",
      json_schema: {
        name: "planCadre",
        schema,
      },
    });
    expect(writerPayload.parameters.tools).toEqual([
      {
        type: "web_search",
        web_search: {
          search_context_size: "large",
          user_location: { city: "Montréal", country: "CA" },
        },
      },
    ]);
  });
});
