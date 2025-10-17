import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { MemoryRouter } from "react-router-dom";

import WorkflowBuilderPage from "../WorkflowBuilderPage";

const logoutMock = vi.hoisted(() => vi.fn());
const openSidebarMock = vi.hoisted(() => vi.fn());
const closeSidebarMock = vi.hoisted(() => vi.fn());
const openSettingsMock = vi.hoisted(() => vi.fn());
const setSidebarContentMock = vi.hoisted(() => vi.fn());
const clearSidebarContentMock = vi.hoisted(() => vi.fn());

vi.mock("../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: { is_admin: true },
    logout: logoutMock,
  }),
}));

vi.mock("../../components/AppLayout", () => ({
  useAppLayout: () => ({
    openSidebar: openSidebarMock,
    closeSidebar: closeSidebarMock,
    openSettings: openSettingsMock,
    isDesktopLayout: true,
    isSidebarOpen: true,
  }),
  useSidebarPortal: () => ({
    setSidebarContent: setSidebarContentMock,
    clearSidebarContent: clearSidebarContentMock,
  }),
}));

const makeApiEndpointCandidatesMock = vi.hoisted(() =>
  vi.fn<[string, string], string[]>((_baseUrl, path) => [path]),
);

const listVectorStoresMock = vi.hoisted(() => vi.fn(async () => []));
const listModelsMock = vi.hoisted(() => vi.fn(async () => []));
const listWidgetsMock = vi.hoisted(() => vi.fn(async () => []));
const listWorkflowWidgetsMock = vi.hoisted(() => vi.fn(async () => []));

vi.mock("../../utils/backend", () => ({
  makeApiEndpointCandidates: makeApiEndpointCandidatesMock,
  vectorStoreApi: {
    listStores: listVectorStoresMock,
  },
  modelRegistryApi: {
    list: listModelsMock,
  },
  widgetLibraryApi: {
    listWidgets: listWidgetsMock,
    listWorkflowWidgets: listWorkflowWidgetsMock,
  },
}));

describe("WorkflowBuilderPage", () => {
  const defaultResponse = {
    id: 2,
    workflow_id: 1,
    workflow_slug: "workflow",
    workflow_display_name: "Workflow de test",
    workflow_is_chatkit_default: true,
    name: "Brouillon",
    version: 2,
    is_active: false,
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

  const defaultWorkflowSummary = {
    id: 1,
    slug: "workflow",
    display_name: "Workflow de test",
    description: null,
    active_version_id: 1,
    active_version_number: 1,
    is_chatkit_default: true,
    versions_count: 2,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  } as const;

  const draftVersionSummary = {
    id: 2,
    workflow_id: 1,
    name: "Brouillon",
    version: 2,
    is_active: false,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  } as const;

  const productionVersionSummary = {
    id: 1,
    workflow_id: 1,
    name: "Production",
    version: 1,
    is_active: true,
    created_at: "2023-12-30T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as const;

  const productionResponse = {
    ...defaultResponse,
    id: 1,
    name: "Production",
    version: 1,
    is_active: true,
    created_at: "2023-12-30T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  } as const;

  const renderWorkflowBuilder = () =>
    render(
      <MemoryRouter>
        <WorkflowBuilderPage />
      </MemoryRouter>,
    );

  const setupWorkflowApi = (
    overrides: {
      workflowDetail?: typeof defaultResponse;
      workflowList?: typeof defaultWorkflowSummary[];
      versions?: Array<typeof draftVersionSummary | typeof productionVersionSummary>;
      putResponse?: unknown;
    } = {},
  ) => {
    const workflowDetail = overrides.workflowDetail ?? defaultResponse;
    const workflowList = overrides.workflowList ?? [defaultWorkflowSummary];
    let versions = [...(overrides.versions ?? [draftVersionSummary, productionVersionSummary])];
    const putResponse = overrides.putResponse ?? { success: true };
    const versionDetails = new Map<number, typeof defaultResponse | typeof productionResponse>([
      [workflowDetail.id, workflowDetail],
      [productionResponse.id, productionResponse],
    ]);
    versions.forEach((version) => {
      if (!versionDetails.has(version.id)) {
        versionDetails.set(version.id, {
          ...defaultResponse,
          id: version.id,
          version: version.version,
          name: version.name,
          is_active: version.is_active,
          updated_at: version.updated_at,
        });
      }
    });

    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (url.endsWith("/api/workflows") && (!init || !init.method || init.method === "GET")) {
        return {
          ok: true,
          status: 200,
          json: async () => workflowList,
        } as Response;
      }
      if (
        url.endsWith(`/api/workflows/${workflowDetail.workflow_id}/versions`) &&
        (!init || !init.method || init.method === "GET")
      ) {
        return {
          ok: true,
          status: 200,
          json: async () => versions,
        } as Response;
      }
      if (
        url.endsWith(`/api/workflows/${workflowDetail.workflow_id}/versions`) &&
        init?.method === "POST"
      ) {
        const highestId = versions.length > 0 ? Math.max(...versions.map((version) => version.id)) : 2;
        const createdId = highestId + 1;
        const created = {
          ...defaultResponse,
          id: createdId,
          version: createdId,
          name: "Nouvelle version",
          updated_at: "2024-01-03T00:00:00Z",
        };
        versionDetails.set(created.id, created);
        versions = [created, ...versions];
        return {
          ok: true,
          status: 200,
          json: async () => created,
        } as Response;
      }
      const versionDetailMatch = url.match(/\/api\/workflows\/\d+\/versions\/(\d+)$/);
      if (versionDetailMatch && init?.method === "PUT") {
        const versionId = Number(versionDetailMatch[1]);
        const detail = versionDetails.get(versionId) ?? defaultResponse;
        const updated = { ...detail, updated_at: "2024-01-04T00:00:00Z" };
        versionDetails.set(versionId, updated);
        versions = versions.map((version) =>
          version.id === versionId ? { ...version, updated_at: updated.updated_at } : version,
        );
        return {
          ok: true,
          status: 200,
          json: async () => updated,
        } as Response;
      }
      if (versionDetailMatch && (!init || !init.method || init.method === "GET")) {
        const versionId = Number(versionDetailMatch[1]);
        const detail = versionDetails.get(versionId) ?? defaultResponse;
        return {
          ok: true,
          status: 200,
          json: async () => detail,
        } as Response;
      }
      if (url.endsWith("/api/workflows/current") && init?.method === "PUT") {
        return {
          ok: true,
          status: 200,
          json: async () => putResponse,
        } as Response;
      }
      if (url.endsWith("/api/workflows/current")) {
        return {
          ok: true,
          status: 200,
          json: async () => workflowDetail,
        } as Response;
      }
      return {
        ok: true,
        status: 200,
        json: async () => ({}),
      } as Response;
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();
    listWorkflowWidgetsMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("permet de modifier un nœud et d'enregistrer le graphe", async () => {
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

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

    const modelInput = await screen.findByPlaceholderText(/ex\. gpt-4\.1-mini/i);
    fireEvent.change(modelInput, { target: { value: "gpt-4.1-mini" } });

    await waitFor(() => {
      expect(screen.queryByLabelText(/niveau de raisonnement/i)).toBeNull();
    });

    const temperatureInput = await screen.findByLabelText(/température/i);
    fireEvent.change(temperatureInput, { target: { value: "0.6" } });

    const topPInput = await screen.findByLabelText(/top-p/i);
    fireEvent.change(topPInput, { target: { value: "0.8" } });

    const maxTokensInput = await screen.findByLabelText(/nombre maximal de tokens générés/i);
    fireEvent.change(maxTokensInput, { target: { value: "600" } });

    const includeHistoryCheckbox = await screen.findByLabelText(/inclure l'historique du chat/i);
    fireEvent.click(includeHistoryCheckbox);

    const showSourcesCheckbox = await screen.findByLabelText(/afficher les sources de recherche/i);
    fireEvent.click(showSourcesCheckbox);

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              typeof input === "string" &&
              input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
              (init as RequestInit | undefined)?.method === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const putCall = [...fetchMock.mock.calls].reverse().find(
      ([input, init]) =>
        typeof input === "string" &&
        input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    expect(body).toHaveProperty("graph");
    const agentNode = body.graph.nodes.find((node: any) => node.slug === "agent-triage");
    expect(agentNode.agent_key).toBe("triage");
    expect(agentNode.display_name).toBe("Analyse enrichie");
    expect(agentNode.parameters).toMatchObject({
      instructions: "Analyse les entrées et produis un résumé clair.",
      model: "gpt-4.1-mini",
      model_settings: {
        temperature: 0.6,
        top_p: 0.8,
        max_output_tokens: 600,
        include_chat_history: false,
        show_search_sources: true,
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

    await screen.findByText(/modifications enregistrées automatiquement/i);
  });

  test("garde le brouillon en tête et réutilise la même révision", async () => {
    const fetchMock = setupWorkflowApi({
      versions: [
        productionVersionSummary,
        { ...draftVersionSummary, name: null, version: 4, updated_at: "2024-01-04T00:00:00Z" },
      ],
      workflowDetail: {
        ...defaultResponse,
        name: null,
        version: 4,
        is_active: false,
        updated_at: "2024-01-04T00:00:00Z",
      },
    });

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const versionSelect = await screen.findByLabelText(/révision/i);
    const options = within(versionSelect).getAllByRole("option");
    expect(options[0]).toHaveTextContent(/^Brouillon$/);

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const modelInput = await screen.findByPlaceholderText(/ex\. gpt-4\.1-mini/i);
    fireEvent.change(modelInput, { target: { value: "gpt-4.1-mini" } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              typeof input === "string" &&
              input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${draftVersionSummary.id}`) &&
              (init as RequestInit | undefined)?.method === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          typeof input === "string" &&
          input.endsWith(`/api/workflows/${defaultResponse.workflow_id}/versions`) &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });

  test("permet de modifier une révision inactive sélectionnée sans créer un nouveau brouillon", async () => {
    const user = userEvent.setup();
    const activeDraft = {
      ...draftVersionSummary,
      id: 5,
      version: 5,
      name: "Brouillon",
      updated_at: "2024-02-01T00:00:00Z",
    } as const;
    const historicalDraft = {
      ...draftVersionSummary,
      id: 4,
      version: 4,
      name: null,
      updated_at: "2023-12-31T00:00:00Z",
    } as const;
    const fetchMock = setupWorkflowApi({
      versions: [activeDraft, historicalDraft, productionVersionSummary],
      workflowDetail: {
        ...defaultResponse,
        id: activeDraft.id,
        version: activeDraft.version,
        name: activeDraft.name,
        updated_at: activeDraft.updated_at,
        is_active: activeDraft.is_active,
      },
    });

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const versionSelect = await screen.findByLabelText(/révision/i);
    await user.selectOptions(versionSelect, historicalDraft.id.toString());

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            typeof input === "string" &&
            input.includes(
              `/api/workflows/${defaultResponse.workflow_id}/versions/${historicalDraft.id}`,
            ) &&
            (!(init as RequestInit | undefined)?.method ||
              (init as RequestInit | undefined)?.method === "GET"),
        ),
      ).toBe(true);
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const modelInput = await screen.findByPlaceholderText(/ex\. gpt-4\.1-mini/i);
    fireEvent.change(modelInput, { target: { value: "gpt-4.1-mini" } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              typeof input === "string" &&
              input.includes(
                `/api/workflows/${defaultResponse.workflow_id}/versions/${historicalDraft.id}`,
              ) &&
              (init as RequestInit | undefined)?.method === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    expect(
      fetchMock.mock.calls.some(
        ([input, init]) =>
          typeof input === "string" &&
          input.endsWith(`/api/workflows/${defaultResponse.workflow_id}/versions`) &&
          (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);
  });



  test("permet d'activer le function tool météo Python", async () => {
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const weatherCheckbox = await screen.findByLabelText(/fonction météo python/i);
    expect(weatherCheckbox).not.toBeChecked();
    fireEvent.click(weatherCheckbox);

    await waitFor(() => {
      expect(weatherCheckbox).toBeChecked();
    });

    const modelInput = await screen.findByPlaceholderText(/ex\. gpt-4\.1-mini/i);
    fireEvent.change(modelInput, { target: { value: "gpt-4.1-mini" } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(
            ([input, init]) =>
              typeof input === "string" &&
              input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
              (init as RequestInit | undefined)?.method === "PUT",
          ),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const putCall = [...fetchMock.mock.calls].reverse().find(
      ([input, init]) =>
        typeof input === "string" &&
        input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const agentNode = body.graph.nodes.find((node: any) => node.slug === "agent-triage");
    expect(agentNode.parameters).toMatchObject({
      tools: [
        {
          type: "function",
          function: {
            name: "fetch_weather",
          },
        },
      ],
    });
  });

  test("détecte les variables du widget et permet de les ingérer", async () => {
    const user = userEvent.setup();
    listWorkflowWidgetsMock.mockResolvedValue([
      {
        slug: "email-card",
        title: "Email",
        description: "Carte de rédaction d'email",
      },
    ]);
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const outputTypeSelect = await screen.findByLabelText(/type de sortie/i);
    await user.selectOptions(outputTypeSelect, "widget");

    await waitFor(() => {
      expect(screen.getByRole("combobox", { name: /type de sortie/i })).toHaveValue("widget");
    });

    await waitFor(() => {
      expect(listWorkflowWidgetsMock).toHaveBeenCalled();
    });

    const widgetSelect = await screen.findByRole("combobox", { name: /widget de sortie/i });
    await user.selectOptions(widgetSelect, "email-card");

    await waitFor(() => {
      expect(screen.queryByRole("region", { name: /variables du widget/i })).not.toBeInTheDocument();
    });

    await screen.findByText(/modifications enregistrées automatiquement/i, { timeout: 4000 });

    const putCall = [...fetchMock.mock.calls].reverse().find(
      ([input, init]) =>
        typeof input === "string" &&
        input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    const payload = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const agentNode = payload.graph.nodes.find((node: any) => node.slug === "agent-triage");
    expect(agentNode.parameters.response_widget).toEqual({ slug: "email-card" });
  });

  test("permet de sélectionner un widget depuis la bibliothèque modale", async () => {
    listWorkflowWidgetsMock.mockResolvedValue([
      {
        slug: "resume",
        title: "Résumé automatique",
        description: "Affiche une carte de synthèse",
      },
      {
        slug: "insights",
        title: "Points clés",
        description: "Liste les éléments importants",
      },
    ]);
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const triageNode = container.querySelector('[data-id="agent-triage"]');
    expect(triageNode).not.toBeNull();
    fireEvent.click(triageNode!);

    const outputTypeSelect = await screen.findByLabelText(/type de sortie/i);
    await user.selectOptions(outputTypeSelect, "widget");

    const browseButton = await screen.findByRole("button", {
      name: /Parcourir la bibliothèque de widgets pour la réponse de l'agent/i,
    });
    await user.click(browseButton);

    await screen.findByRole("dialog", { name: /bibliothèque de widgets/i });

    const resumeButton = await screen.findByRole("button", {
      name: /Résumé automatique/i,
    });
    await user.click(resumeButton);

    await waitFor(() => {
      expect(screen.queryByRole("dialog", { name: /bibliothèque de widgets/i })).not.toBeInTheDocument();
    });

    const widgetSelect = await screen.findByRole("combobox", { name: /widget de sortie/i });
    expect(widgetSelect).toHaveValue("resume");

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) =>
            typeof input === "string" &&
            input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
            (init as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(true);
    });

    const putCall = [...fetchMock.mock.calls].reverse().find(
      ([input, init]) =>
        typeof input === "string" &&
        input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    const payload = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const agentNode = payload.graph.nodes.find((node: any) => node.slug === "agent-triage");
    expect(agentNode.parameters.response_widget).toEqual({ slug: "resume" });
  });

  test("pré-remplit un agent hérité avec les valeurs par défaut", async () => {
    setupWorkflowApi({ workflowDetail: JSON.parse(JSON.stringify(defaultResponse)) });

    const { container } = renderWorkflowBuilder();

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

    const modelInput = await screen.findByPlaceholderText(/ex\. gpt-4\.1-mini/i);
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

    setupWorkflowApi({ workflowDetail: responseWithWeb });

    const { container } = renderWorkflowBuilder();

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

    const fetchMock = setupWorkflowApi({ workflowDetail: responseWithState });

    const { container } = renderWorkflowBuilder();

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

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const putCall = [...fetchMock.mock.calls]
      .reverse()
      .find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    const payload = JSON.parse((putCall?.[1] as RequestInit).body as string);
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
    const fetchMock = setupWorkflowApi({ workflowDetail: JSON.parse(JSON.stringify(defaultResponse)) });

    const { container } = renderWorkflowBuilder();

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

    await screen.findByText(/modifications enregistrées automatiquement/i, { timeout: 4000 });

    const putCall = [...fetchMock.mock.calls].reverse().find(
      ([input, init]) =>
        typeof input === "string" &&
        input.includes(`/api/workflows/${defaultResponse.workflow_id}/versions/${defaultResponse.id}`) &&
        (init as RequestInit | undefined)?.method === "PUT",
    );
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const writerPayload = body.graph.nodes.find((node: any) => node.slug === "writer");
    expect(writerPayload.parameters.response_format).toMatchObject({
      type: "json_schema",
      json_schema: {
        name: "planCadre",
      },
    });
    expect(writerPayload.parameters.response_format.json_schema.schema).toBeTruthy();
    expect(writerPayload.parameters.tools).toHaveLength(1);
    expect(writerPayload.parameters.tools[0]).toMatchObject({
      type: "web_search",
      web_search: {
        user_location: { city: "Montréal", country: "CA" },
      },
    });
    expect(
      writerPayload.parameters.tools[0]?.web_search?.search_context_size,
    ).toBeTruthy();
  });

  test("permet d'ajouter un bloc widget et de le configurer", async () => {
    listWorkflowWidgetsMock.mockResolvedValue([
      {
        slug: "resume",
        title: "Résumé automatique",
        description: null,
      },
      {
        slug: "graphique",
        title: "Graphique",
        description: null,
      },
    ]);
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const widgetButton = await screen.findByRole("button", { name: /bloc widget/i });
    fireEvent.click(widgetButton);

    const widgetNode = await waitFor(() => container.querySelector('[data-id^="widget-"]'));
    expect(widgetNode).not.toBeNull();
    fireEvent.click(widgetNode!);

    const widgetSelect = await screen.findByLabelText(/widget à afficher/i);
    fireEvent.change(widgetSelect, { target: { value: "resume" } });

    const addVariableButton = await screen.findByRole("button", { name: /ajouter une variable/i });
    fireEvent.click(addVariableButton);

    const identifierInput = await screen.findByPlaceholderText(/ex\. title/i);
    fireEvent.change(identifierInput, { target: { value: "title" } });

    const expressionInput = await screen.findByPlaceholderText(/ex\. input\.output_parsed\.titre/i);
    fireEvent.change(expressionInput, { target: { value: "state.resume" } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const putCall = [...fetchMock.mock.calls]
      .reverse()
      .find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const widgetPayload = body.graph.nodes.find((node: any) => node.kind === "widget");
    expect(widgetPayload).toBeTruthy();
    expect(widgetPayload.parameters).toEqual({
      widget: { slug: "resume", variables: { title: "state.resume" } },
    });
  });

  test("permet de saisir un widget manuellement lorsque la bibliothèque est indisponible", async () => {
    listWorkflowWidgetsMock.mockRejectedValueOnce(new Error("Bibliothèque inaccessible"));
    const fetchMock = setupWorkflowApi();

    const { container } = renderWorkflowBuilder();

    await waitFor(() => {
      expect(container.querySelector('[data-id="agent-triage"]')).not.toBeNull();
    });

    const widgetButton = await screen.findByRole("button", { name: /bloc widget/i });
    fireEvent.click(widgetButton);

    const widgetNode = await waitFor(() => container.querySelector('[data-id^="widget-"]'));
    expect(widgetNode).not.toBeNull();
    fireEvent.click(widgetNode!);

    const widgetSlugInput = await screen.findByLabelText(/^slug du widget$/i);
    fireEvent.change(widgetSlugInput, { target: { value: "resume" } });

    await waitFor(
      () => {
        expect(
          fetchMock.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === "PUT"),
        ).toBe(true);
      },
      { timeout: 4000 },
    );

    const putCall = [...fetchMock.mock.calls]
      .reverse()
      .find(([, init]) => (init as RequestInit | undefined)?.method === "PUT");
    const body = JSON.parse((putCall?.[1] as RequestInit).body as string);
    const widgetPayload = body.graph.nodes.find((node: any) => node.kind === "widget");
    expect(widgetPayload).toBeTruthy();
    expect(widgetPayload.parameters).toEqual({ widget: { slug: "resume" } });
  });
});
