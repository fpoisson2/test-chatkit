import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

    const agentSelect = await screen.findByLabelText(/agent chatkit/i);
    expect(agentSelect).toHaveValue("triage");

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

    const parametersTextarea = await screen.findByLabelText<HTMLTextAreaElement>(
      /paramètres json avancés/i,
    );
    const rawParameters = parametersTextarea.value;
    expect(rawParameters).toContain("Analyse les entrées et produis un résumé clair.");

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
    expect(agentNode.agent_key).toBe("triage");
    expect(agentNode.display_name).toBe("Analyse enrichie");
    expect(agentNode.parameters).toMatchObject({
      instructions: "Analyse les entrées et produis un résumé clair.",
      model: "gpt-4.1-mini",
      model_settings: {
        store: true,
        temperature: 0.6,
        top_p: 0.8,
      },
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "TriageSchema",
          schema: expect.objectContaining({
            properties: expect.objectContaining({ has_all_details: expect.any(Object) }),
          }),
        },
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

    const agentSelect = await screen.findByLabelText(/agent chatkit/i);
    expect(agentSelect).toHaveValue("triage");

    const messageTextarea = await screen.findByLabelText<HTMLTextAreaElement>(/message système/i);
    expect(messageTextarea.value).toContain(
      "Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.",
    );

    const modelInput = await screen.findByLabelText(/modèle openai/i);
    expect(modelInput).toHaveValue("gpt-5");

    const reasoningSelect = await screen.findByLabelText(/niveau de raisonnement/i);
    expect(reasoningSelect).toHaveValue("minimal");

    const triageResponseType = await screen.findByLabelText(/type de sortie/i);
    expect(triageResponseType).toHaveValue("json_schema");

    const triageSchemaTextarea = await screen.findByLabelText(/définition du schéma json/i);
    expect(triageSchemaTextarea.value).toContain("has_all_details");

    const writerNode = container.querySelector('[data-id="writer"]');
    expect(writerNode).not.toBeNull();
    fireEvent.click(writerNode!);

    const writerAgentSelect = await screen.findByLabelText(/agent chatkit/i);
    expect(writerAgentSelect).toHaveValue("r_dacteur");

    await waitFor(() => {
      expect(screen.queryByLabelText(/niveau de raisonnement/i)).toBeNull();
    });

    const writerTemperature = await screen.findByLabelText(/température/i);
    expect(writerTemperature).toHaveValue(1);

    const writerTopP = await screen.findByLabelText(/top-p/i);
    expect(writerTopP).toHaveValue(1);

    const writerResponseType = await screen.findByLabelText(/type de sortie/i);
    expect(writerResponseType).toHaveValue("json_schema");

    const writerSchemaTextarea = await screen.findByLabelText(/définition du schéma json/i);
    expect(writerSchemaTextarea.value).toContain("intro_place_cours");
  });

  test("pré-remplit la configuration de recherche web héritée", async () => {
    const responseWithWeb = JSON.parse(JSON.stringify(defaultResponse));
    responseWithWeb.graph.nodes.splice(2, 0, {
      id: 5,
      slug: "collecte-web",
      kind: "agent",
      display_name: "Collecte web",
      agent_key: "get_data_from_web",
      is_enabled: true,
      parameters: {},
      metadata: { position: { x: 360, y: 120 } },
    });
    responseWithWeb.graph.edges = [
      { id: 1, source: "start", target: "agent-triage", condition: null, metadata: {} },
      { id: 2, source: "agent-triage", target: "collecte-web", condition: null, metadata: {} },
      { id: 3, source: "collecte-web", target: "writer", condition: null, metadata: {} },
      { id: 4, source: "writer", target: "end", condition: null, metadata: {} },
    ];

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => responseWithWeb,
    } as Response);

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="collecte-web"]')).not.toBeNull();
    });

    const webNode = container.querySelector('[data-id="collecte-web"]');
    expect(webNode).not.toBeNull();
    fireEvent.click(webNode!);

    const webToggle = await screen.findByLabelText(/activer la recherche web/i);
    expect(webToggle).toBeChecked();

    const searchScopeSelect = await screen.findByLabelText(/portée de la recherche/i);
    expect(searchScopeSelect).toHaveValue("medium");

    expect(await screen.findByLabelText(/ville/i)).toHaveValue("Québec");
    expect(await screen.findByLabelText(/pays/i)).toHaveValue("CA");
    expect(await screen.findByLabelText(/région/i)).toHaveValue("QC");
    expect(await screen.findByLabelText(/type de précision/i)).toHaveValue("approximate");
  });

  test("permet de configurer un bloc état", async () => {
    const responseWithState = JSON.parse(JSON.stringify(defaultResponse));
    responseWithState.graph.nodes.splice(2, 0, {
      id: 6,
      slug: "maj-etat",
      kind: "state",
      display_name: "Mettre à jour l'état",
      agent_key: null,
      is_enabled: true,
      parameters: {
        globals: [{ target: "global.workflow_name", expression: '"PlanCadre"' }],
        state: [
          { target: "state.has_all_details", expression: "input.output_parsed.has_all_details" },
          { target: "state.infos_manquantes", expression: "input.output_text" },
        ],
      },
      metadata: { position: { x: 360, y: 120 } },
    });
    responseWithState.graph.edges = [
      { id: 1, source: "start", target: "agent-triage", condition: null, metadata: {} },
      { id: 2, source: "agent-triage", target: "maj-etat", condition: null, metadata: {} },
      { id: 3, source: "maj-etat", target: "writer", condition: null, metadata: {} },
      { id: 4, source: "writer", target: "end", condition: null, metadata: {} },
    ];

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => responseWithState,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ success: true }),
      } as Response);

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="maj-etat"]')).not.toBeNull();
    });

    const stateNode = container.querySelector('[data-id="maj-etat"]');
    expect(stateNode).not.toBeNull();
    fireEvent.click(stateNode!);

    const globalPanel = await screen.findByRole("region", { name: /variables globales/i });
    const globalValueInputs = within(globalPanel).getAllByLabelText(/Affecter la valeur/i);
    const globalTargetInputs = within(globalPanel).getAllByLabelText(/Vers la variable/i);
    expect(globalValueInputs[0]).toHaveValue('"PlanCadre"');
    expect(globalTargetInputs[0]).toHaveValue("global.workflow_name");

    const statePanel = screen.getByRole("region", { name: /variables d'état/i });
    const stateValueInputs = within(statePanel).getAllByLabelText(/Affecter la valeur/i);
    const stateTargetInputs = within(statePanel).getAllByLabelText(/Vers la variable/i);
    expect(stateValueInputs[0]).toHaveValue("input.output_parsed.has_all_details");
    expect(stateTargetInputs[0]).toHaveValue("state.has_all_details");
    expect(stateValueInputs[1]).toHaveValue("input.output_text");
    expect(stateTargetInputs[1]).toHaveValue("state.infos_manquantes");

    fireEvent.change(stateValueInputs[1], { target: { value: "input.output_structured.details" } });
    fireEvent.change(stateTargetInputs[1], { target: { value: "state.details_a_collecter" } });

    const addGlobalButton = within(globalPanel).getByRole("button", { name: /ajouter une variable globale/i });
    fireEvent.click(addGlobalButton);
    const updatedGlobalValues = within(globalPanel).getAllByLabelText(/Affecter la valeur/i);
    const updatedGlobalTargets = within(globalPanel).getAllByLabelText(/Vers la variable/i);
    fireEvent.change(updatedGlobalValues[updatedGlobalValues.length - 1], {
      target: { value: "state.has_all_details" },
    });
    fireEvent.change(updatedGlobalTargets[updatedGlobalTargets.length - 1], {
      target: { value: "global.validation" },
    });

    const saveButton = screen.getByRole("button", { name: /enregistrer les modifications/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    const [, putRequest] = fetchMock.mock.calls[1];
    const payload = JSON.parse((putRequest as RequestInit).body as string);
    const statePayload = payload.graph.nodes.find((node: any) => node.slug === "maj-etat");
    expect(statePayload.parameters).toEqual({
      globals: [
        { target: "global.workflow_name", expression: '"PlanCadre"' },
        { target: "global.validation", expression: "state.has_all_details" },
      ],
      state: [
        { target: "state.has_all_details", expression: "input.output_parsed.has_all_details" },
        { target: "state.details_a_collecter", expression: "input.output_structured.details" },
      ],
    });
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
