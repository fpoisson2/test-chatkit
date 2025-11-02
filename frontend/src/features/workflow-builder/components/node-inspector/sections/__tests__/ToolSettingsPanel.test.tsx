import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, beforeEach, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n";
import type { WorkflowSummary } from "../../../types";
import { ToolSettingsPanel } from "../ToolSettingsPanel";

vi.mock("../../../../../../auth", () => ({
  useAuth: () => ({
    token: "test-token",
    user: null,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

const { listMock, createMock, probePersistedMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  createMock: vi.fn(),
  probePersistedMock: vi.fn(),
}));

vi.mock("../../../../../../utils/backend", async () => {
  const actual = await vi.importActual<typeof import("../../../../../../utils/backend")>(
    "../../../../../../utils/backend",
  );
  return {
    ...actual,
    mcpServersApi: {
      ...actual.mcpServersApi,
      list: listMock,
      create: createMock,
      update: vi.fn(),
      delete: vi.fn(),
      probe: probePersistedMock,
    },
    probeMcpServer: probePersistedMock,
  };
});

const baseWorkflows: WorkflowSummary[] = [
  {
    id: 1,
    slug: "main",
    display_name: "Main",
    description: null,
    active_version_id: 1,
    active_version_number: 1,
    is_chatkit_default: false,
    versions_count: 1,
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

const sampleServers = [
  {
    id: 1,
    label: "Alpha",
    server_url: "https://alpha.example.com",
    transport: "http_sse",
    is_active: true,
    oauth_client_id: null,
    oauth_scope: null,
    oauth_authorization_endpoint: null,
    oauth_token_endpoint: null,
    oauth_redirect_uri: null,
    oauth_metadata: null,
    authorization_hint: "****ALPHA",
    access_token_hint: null,
    refresh_token_hint: null,
    oauth_client_secret_hint: null,
    tools_cache: { tool_names: ["alpha-tool", "beta-tool"] },
    tools_cache_updated_at: "2024-01-01T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-01T00:00:00Z",
  },
  {
    id: 2,
    label: "Beta",
    server_url: "https://beta.example.com",
    transport: "http_sse",
    is_active: true,
    oauth_client_id: null,
    oauth_scope: null,
    oauth_authorization_endpoint: null,
    oauth_token_endpoint: null,
    oauth_redirect_uri: null,
    oauth_metadata: null,
    authorization_hint: null,
    access_token_hint: null,
    refresh_token_hint: null,
    oauth_client_secret_hint: null,
    tools_cache: { tool_names: ["gamma-tool"] },
    tools_cache_updated_at: "2024-01-02T00:00:00Z",
    created_at: "2024-01-01T00:00:00Z",
    updated_at: "2024-01-02T00:00:00Z",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  listMock.mockResolvedValue([]);
  createMock.mockResolvedValue(sampleServers[0]);
  probePersistedMock.mockResolvedValue({ status: "ok", tool_names: [] });
});

const renderPanel = (
  overrides: Partial<Parameters<typeof ToolSettingsPanel>[0]> = {},
) => {
  const defaultProps: Parameters<typeof ToolSettingsPanel>[0] = {
    nodeId: "agent-1",
    parameters: {},
    workflows: baseWorkflows,
    currentWorkflowId: 1,
    onAgentWeatherToolChange: vi.fn(),
    onAgentWidgetValidationToolChange: vi.fn(),
    onAgentWorkflowValidationToolChange: vi.fn(),
    onAgentWorkflowToolToggle: vi.fn(),
    onAgentMcpServersChange: vi.fn(),
    onStartMcpOAuth: vi.fn().mockResolvedValue({
      authorization_url: "https://auth.example/authorize",
      state: "state",
      expires_in: 300,
      redirect_uri: "https://example.com/callback",
    }),
    onPollMcpOAuth: vi.fn().mockResolvedValue({
      state: "state",
      status: "pending",
      expires_in: 300,
    }),
    onCancelMcpOAuth: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };

  render(
    <I18nProvider>
      <ToolSettingsPanel {...defaultProps} />
    </I18nProvider>,
  );

  return defaultProps;
};

describe("ToolSettingsPanel", () => {

  it("selects persisted MCP servers and updates allowlists", async () => {
    listMock.mockResolvedValue(sampleServers);
    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    const alphaCheckbox = await screen.findByLabelText(/Alpha/);
    await userEvent.click(alphaCheckbox);
    await waitFor(() => expect(onAgentMcpServersChange).toHaveBeenCalled());

    const betaCheckbox = screen.getByLabelText(/Beta/);
    await userEvent.click(betaCheckbox);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: [] },
        { serverId: 2, toolNames: [] },
      ]);
    });

    const alphaCard = alphaCheckbox.closest("label")?.parentElement;
    expect(alphaCard).not.toBeNull();
    const restrictToggle = within(alphaCard as HTMLElement).getByRole("switch", {
      name: /Limiter aux outils sélectionnés|Restrict to selected tools/i,
    });
    await userEvent.click(restrictToggle);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["alpha-tool", "beta-tool"] },
        { serverId: 2, toolNames: [] },
      ]);
    });

    const betaToolChip = within(alphaCard as HTMLElement).getByLabelText(/beta-tool/i);
    await userEvent.click(betaToolChip);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["alpha-tool"] },
        { serverId: 2, toolNames: [] },
      ]);
    });
  });

  it("manages manual allowlists and probes servers", async () => {
    listMock.mockResolvedValue(sampleServers);
    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    const alphaCheckbox = await screen.findByLabelText(/Alpha/);
    await userEvent.click(alphaCheckbox);
    await waitFor(() => expect(onAgentMcpServersChange).toHaveBeenCalled());

    const alphaCard = alphaCheckbox.closest("label")?.parentElement as HTMLElement;
    const input = within(alphaCard).getByPlaceholderText(/Nom d'outil|Tool name/i);
    await userEvent.type(input, "delta-tool");
    const addButton = within(alphaCard).getByRole("button", { name: /^(Ajouter|Add)$/i });
    await userEvent.click(addButton);

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 1, toolNames: ["delta-tool"] },
      ]);
    });

    probePersistedMock.mockResolvedValueOnce({
      status: "ok",
      detail: "ok",
      tool_names: ["alpha-tool"],
    });

    const probeButton = within(alphaCard).getByRole("button", {
      name: /Refresh tool cache|Rafraîchir le cache des outils/i,
    });
    await userEvent.click(probeButton);

    await waitFor(() => {
      expect(probePersistedMock).toHaveBeenCalledWith("test-token", {
        serverId: 1,
        url: "https://alpha.example.com",
      });
    });
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
  });

  it("tests a new MCP server connection from the modal", async () => {
    renderPanel();

    await userEvent.click(
      screen.getByRole("button", {
        name: /Ajouter un serveur MCP|Add an MCP server/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText(/Libellé|Label/i),
      "Gamma",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/URL du serveur MCP|MCP server URL/i),
      "https://gamma.example.com",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/Authorization|Autorisation/i),
      "Bearer test",
    );

    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /Refresh tool cache|Rafraîchir le cache des outils/i,
      }),
    );

    await waitFor(() => {
      expect(probePersistedMock).toHaveBeenCalledWith("test-token", {
        url: "https://gamma.example.com",
        authorization: "Bearer test",
      });
    });
  });

  it("creates a new MCP server via the modal", async () => {
    const createdServer = {
      ...sampleServers[0],
      id: 3,
      label: "Gamma",
      server_url: "https://gamma.example.com",
    };
    listMock.mockResolvedValueOnce(sampleServers);
    listMock.mockResolvedValueOnce([...sampleServers, createdServer]);
    createMock.mockResolvedValue(createdServer);

    const onAgentMcpServersChange = vi.fn();
    renderPanel({ onAgentMcpServersChange });

    await screen.findByText(/Alpha/);
    await userEvent.click(
      screen.getByRole("button", {
        name: /Ajouter un serveur MCP|Add an MCP server/i,
      }),
    );

    const dialog = await screen.findByRole("dialog");
    await userEvent.type(
      within(dialog).getByLabelText(/Libellé|Label/i),
      "Gamma",
    );
    await userEvent.type(
      within(dialog).getByLabelText(/URL du serveur MCP|MCP server URL/i),
      "https://gamma.example.com",
    );
    await userEvent.click(
      within(dialog).getByRole("button", {
        name: /Créer le serveur|Create server/i,
      }),
    );

    await waitFor(() => {
      expect(createMock).toHaveBeenCalledWith(
        "test-token",
        expect.objectContaining({
          label: "Gamma",
          server_url: "https://gamma.example.com",
        }),
      );
    });

    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());

    await waitFor(() => {
      expect(onAgentMcpServersChange).toHaveBeenLastCalledWith("agent-1", [
        { serverId: 3, toolNames: [] },
      ]);
    });
  });
});
