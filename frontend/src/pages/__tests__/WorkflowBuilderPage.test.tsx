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
  vi.fn<[string, string], string[]>((_, path) => [path]),
);

vi.mock("../../utils/backend", () => ({
  makeApiEndpointCandidates: makeApiEndpointCandidatesMock,
}));

describe("WorkflowBuilderPage", () => {
  const DEFAULT_WORKFLOW_ID = 1;
  const DEFAULT_VERSION_ID = 10;

  const defaultModelsResponse = [
    { id: 1, name: "gpt-4.1-mini", display_name: "GPT-4.1 Mini", supports_reasoning: false },
    { id: 2, name: "gpt-4.1", display_name: "GPT-4.1", supports_reasoning: true },
    { id: 3, name: "o4-mini", display_name: "O4 Mini", supports_reasoning: true },
  ] as const;

  const defaultWorkflowsResponse = [
    {
      id: DEFAULT_WORKFLOW_ID,
      slug: "plan-cadre",
      display_name: "Plan Cadre",
      description: "Workflow principal",
      active_version_id: DEFAULT_VERSION_ID,
      active_version_number: 3,
      is_chatkit_default: true,
      versions_count: 1,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    },
  ] as const;

  const defaultVersionsResponse = [
    {
      id: DEFAULT_VERSION_ID,
      workflow_id: DEFAULT_WORKFLOW_ID,
      name: "Version active",
      version: 3,
      is_active: true,
      created_at: "2024-01-01T00:00:00Z",
      updated_at: "2024-01-02T00:00:00Z",
    },
  ] as const;

  const defaultVersionDetail = {
    id: DEFAULT_VERSION_ID,
    workflow_id: DEFAULT_WORKFLOW_ID,
    workflow_slug: "plan-cadre",
    workflow_display_name: "Plan Cadre",
    workflow_is_chatkit_default: true,
    name: "Version active",
    version: 3,
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
    steps: [],
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  } as const;

  const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

  type FetchMockOptions = {
    models?: Array<(typeof defaultModelsResponse)[number]>;
    workflows?: Array<(typeof defaultWorkflowsResponse)[number]>;
    versions?: Array<(typeof defaultVersionsResponse)[number]>;
    versionDetails?: Record<number, typeof defaultVersionDetail>;
    workflowId?: number;
    postVersionId?: number;
  };

  const jsonResponse = <T,>(data: T, status = 200) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => data,
    }) as Response;

  const setupFetchMock = (options: FetchMockOptions = {}) => {
    const initialDetail = options.versionDetails
      ? Object.values(options.versionDetails)[0]
      : defaultVersionDetail;
    const workflowId = options.workflowId ?? initialDetail.workflow_id ?? DEFAULT_WORKFLOW_ID;
    const models = options.models ?? deepClone(defaultModelsResponse);
    const workflows = options.workflows ?? deepClone(defaultWorkflowsResponse);
    const versions = (options.versions ?? deepClone(defaultVersionsResponse)).map((version) => ({
      ...version,
      workflow_id: workflowId,
    }));
    const detailsSource = options.versionDetails ?? {
      [defaultVersionDetail.id]: {
        ...deepClone(defaultVersionDetail),
        workflow_id: workflowId,
      },
    };
    const versionDetails = Object.entries(detailsSource).reduce<Record<number, typeof defaultVersionDetail>>(
      (acc, [key, value]) => {
        const numericKey = Number(key);
        acc[numericKey] = { ...deepClone(value), workflow_id: workflowId };
        return acc;
      },
      {},
    );
    const postVersionId =
      options.postVersionId ??
      (versions.find((version) => version.is_active)?.id ??
        Number(Object.keys(versionDetails)[0]) ??
        DEFAULT_VERSION_ID);

    return vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "/api/admin/models") {
        return Promise.resolve(jsonResponse(models));
      }
      if (url === "/api/workflows") {
        return Promise.resolve(jsonResponse(workflows));
      }
      if (url === `/api/workflows/${workflowId}/versions`) {
        if (init?.method === "POST") {
          const detail = versionDetails[postVersionId];
          if (!detail) {
            throw new Error(`Aucune version ${postVersionId} enregistrée dans le mock.`);
          }
          return Promise.resolve(jsonResponse(detail));
        }
        return Promise.resolve(jsonResponse(versions));
      }
      const match = url.match(new RegExp(`^/api/workflows/${workflowId}/versions/(\\d+)$`));
      if (match) {
        const versionId = Number(match[1]);
        const detail = versionDetails[versionId];
        if (!detail) {
          throw new Error(`Aucune réponse maquetée pour la version ${versionId}.`);
        }
        return Promise.resolve(jsonResponse(detail));
      }
      return Promise.reject(new Error(`Requête inattendue vers ${url}`));
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("permet de modifier un nœud et d'enregistrer le graphe", async () => {
    const fetchMock = setupFetchMock();

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

    const modelSelect = await screen.findByLabelText(/modèle openai/i);
    fireEvent.change(modelSelect, { target: { value: "gpt-4.1-mini" } });

    await waitFor(() => {
      expect(screen.queryByLabelText(/niveau de raisonnement/i)).toBeNull();
    });

    const maxTokensInput = await screen.findByLabelText(/nombre maximal de tokens/i);
    fireEvent.change(maxTokensInput, { target: { value: "4096" } });

    const temperatureInput = await screen.findByLabelText(/température/i);
    fireEvent.change(temperatureInput, { target: { value: "0.6" } });

    const topPInput = await screen.findByLabelText(/top-p/i);
    fireEvent.change(topPInput, { target: { value: "0.8" } });

    const includeHistorySelect = await screen.findByLabelText(/inclure l'historique du chat/i);
    fireEvent.change(includeHistorySelect, { target: { value: "true" } });

    const displayResponseSelect = await screen.findByLabelText(/afficher la réponse dans le chat/i);
    fireEvent.change(displayResponseSelect, { target: { value: "false" } });

    const showSourcesSelect = await screen.findByLabelText(/afficher les sources de recherche/i);
    fireEvent.change(showSourcesSelect, { target: { value: "true" } });

    const continueOnErrorSelect = await screen.findByLabelText(/continuer en cas d'erreur/i);
    fireEvent.change(continueOnErrorSelect, { target: { value: "false" } });

    const writeHistorySelect = await screen.findByLabelText(/écrire dans l'historique du workflow/i);
    fireEvent.change(writeHistorySelect, { target: { value: "true" } });

    const parametersTextarea = await screen.findByLabelText<HTMLTextAreaElement>(
      /paramètres json avancés/i,
    );
    const rawParameters = parametersTextarea.value;
    expect(rawParameters).toContain("Analyse les entrées et produis un résumé clair.");

    const saveButton = screen.getByRole("button", { name: /enregistrer les modifications/i });
    fireEvent.click(saveButton);

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/models");

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();

    const body = JSON.parse((postCall?.[1] as RequestInit).body as string);
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
        max_output_tokens: 4096,
      },
      include_chat_history: true,
      display_response_in_chat: false,
      show_search_sources: true,
      continue_on_error: false,
      write_to_conversation_history: true,
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

    await screen.findByText(/nouvelle version enregistrée avec succès/i);
  });

  test("pré-remplit un agent hérité avec les valeurs par défaut", async () => {
    const versionResponse = deepClone(defaultVersionDetail);
    setupFetchMock({
      versionDetails: {
        [versionResponse.id]: versionResponse,
      },
    });

    const { container } = render(<WorkflowBuilderPage />);

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const messageTextarea = await screen.findByLabelText<HTMLTextAreaElement>(/message système/i);
    expect(messageTextarea.value).toContain(
      "Ton rôle : Vérifier si toutes les informations nécessaires sont présentes pour générer un plan-cadre.",
    );

    const modelSelect = await screen.findByLabelText(/modèle openai/i);
    expect(modelSelect).toHaveValue("gpt-5");

    const reasoningSelect = await screen.findByLabelText(/niveau de raisonnement/i);
    expect(reasoningSelect).toHaveValue("minimal");

    const triageResponseType = await screen.findByLabelText(/type de sortie/i);
    expect(triageResponseType).toHaveValue("json_schema");

    const triageSchemaTextarea = await screen.findByLabelText(/définition du schéma json/i);
    expect(triageSchemaTextarea.value).toContain("has_all_details");

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

    const writerResponseType = await screen.findByLabelText(/type de sortie/i);
    expect(writerResponseType).toHaveValue("json_schema");

    const writerSchemaTextarea = await screen.findByLabelText(/définition du schéma json/i);
    expect(writerSchemaTextarea.value).toContain("intro_place_cours");
  });

  test("pré-remplit la configuration de recherche web héritée", async () => {
    const responseWithWeb = deepClone(defaultVersionDetail);
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

    setupFetchMock({
      versionDetails: {
        [responseWithWeb.id]: responseWithWeb,
      },
    });

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
    const responseWithState = deepClone(defaultVersionDetail);
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

    const fetchMock = setupFetchMock({
      versionDetails: {
        [responseWithState.id]: responseWithState,
      },
    });

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
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, postRequest] = postCall!;
    const payload = JSON.parse((postRequest as RequestInit).body as string);
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
    const versionResponse = deepClone(defaultVersionDetail);
    const fetchMock = setupFetchMock({
      versionDetails: {
        [versionResponse.id]: versionResponse,
      },
    });

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
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
            (init as RequestInit | undefined)?.method === "POST",
        ),
      ).toBe(true);
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/models");

    const postCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        url === `/api/workflows/${DEFAULT_WORKFLOW_ID}/versions` &&
        (init as RequestInit | undefined)?.method === "POST",
    );
    expect(postCall).toBeDefined();
    const [, postRequest] = postCall!;
    const body = JSON.parse((postRequest as RequestInit).body as string);
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
